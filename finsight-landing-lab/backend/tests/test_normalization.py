import pytest

from app.normalization import (
    CsvValidationError,
    discover_fields,
    extract_company_name,
    normalize_csv_rows,
    parse_csv_content,
    parse_number,
)
from app.calculations import calculate_ratios


def test_parse_csv_preserves_duplicate_headers_and_raw_values():
    parsed = parse_csv_content(
        "balance-sheet.csv",
        b"Line Item,2023,2023\nTotal Assets,1,2\n",
    )

    assert parsed.headers == ["Line Item", "2023", "2023"]
    assert parsed.rows == [["Total Assets", "1", "2"]]
    lines = normalize_csv_rows(parsed.headers, parsed.rows, "balance-sheet.csv")
    assert [line["value"] for line in lines] == [1.0, 2.0]
    assert [line["period"] for line in lines] == ["2023", "2023"]
    assert all(line["mapping_status"] == "ambiguous" for line in lines)


def test_wide_and_long_statement_periods_and_types_are_supported():
    wide = normalize_csv_rows(
        ["Account", "2023", "2024"],
        [["Revenue", "100", "125"], ["Cash and equivalents", "20", "25"]],
        "combined.csv",
    )
    long = normalize_csv_rows(
        ["Statement Type", "Line Item", "Reporting Period", "Value", "Currency", "Unit"],
        [["Cash Flow", "Operating cash flow", "FY2024", "(₹1,200)", "INR", "thousands"]],
        "combined.csv",
    )

    assert [(line["field_name"], line["statement_type"], line["period"]) for line in wide] == [
        ("revenue", "income_statement", "2023"),
        ("revenue", "income_statement", "2024"),
        ("cash_and_equivalents", "balance_sheet", "2023"),
        ("cash_and_equivalents", "balance_sheet", "2024"),
    ]
    assert long[0]["statement_type"] == "cash_flow"
    assert long[0]["period"] == "2024"
    assert long[0]["value"] == -1200
    assert long[0]["currency"] == "INR"
    assert long[0]["unit"] == "thousands"
    assert long[0]["period_kind"] == "duration"


def test_unmapped_invalid_and_missing_values_are_retained_for_review():
    rows = normalize_csv_rows(
        ["Line Item", "2024"],
        [["Special disclosure", "custom text"], ["Total Assets", "not-a-number"], ["Revenue", ""]],
        "notes.csv",
    )

    assert rows[0]["mapping_status"] == "unmapped"
    assert rows[0]["field_name"] == "special_disclosure"
    assert rows[0]["raw_value"] == "custom text"
    assert rows[1]["mapping_status"] == "invalid"
    assert rows[1]["value"] is None
    assert rows[2]["mapping_status"] == "missing"
    assert rows[2]["value"] is None


def test_dynamic_discovery_preserves_unknown_headers_and_infers_conservative_types():
    headers = ["Custom score", "Analyst note", "As of", "Approved", "Mixed field"]
    rows = [
        ["12.5", "Stable outlook", "2024-03-31", "TRUE", "17"],
        ["14", "Needs follow-up", "2024-06-30", "false", "not reported"],
    ]
    fields = discover_fields(headers, rows)
    assert [field["source_header"] for field in fields] == headers
    assert [field["candidate_identifier"] for field in fields] == ["custom_score", "analyst_note", "as_of", "approved", "mixed_field"]
    assert [field["inferred_type"] for field in fields] == ["numeric", "text", "date", "boolean", "mixed"]
    assert all(field["mapping_status"] == "unmapped" for field in fields if field["field_role"] == "metric")
    lines = normalize_csv_rows(headers, rows, "custom.csv", fields)
    assert [(line["field_name"], line["raw_value"], line["mapping_status"]) for line in lines[:2]] == [
        ("custom_score", "12.5", "unmapped"), ("analyst_note", "Stable outlook", "unmapped"),
    ]
    assert lines[0]["value"] == 12.5
    assert lines[1]["value"] is None
    assert lines[0]["source_metadata"]["source_header"] == "Custom score"


def test_header_based_financial_fields_map_without_treating_context_as_metrics():
    headers = ["Company", "Reporting Period", "Statement Type", "Currency", "Unit", "Revenue", "Custom Exposure"]
    rows = [["Example Co", "FY2024", "Income Statement", "USD", "thousands", "1250", "42"]]
    parsed = parse_csv_content("custom.csv", (",".join(headers) + "\n" + ",".join(rows[0]) + "\n").encode())
    fields = discover_fields(parsed.headers, parsed.rows)
    lines = normalize_csv_rows(parsed.headers, parsed.rows, "custom.csv", fields)
    revenue = next(line for line in lines if line["field_name"] == "revenue")
    custom = next(line for line in lines if line["field_name"] == "custom_exposure")
    assert extract_company_name(parsed.headers, parsed.rows) == "Example Co"
    assert revenue["period"] == "2024"
    assert revenue["statement_type"] == "income_statement"
    assert revenue["currency"] == "USD"
    assert revenue["unit"] == "thousands"
    assert revenue["mapping_status"] == "mapped"
    assert revenue["source_metadata"]["company"] == "Example Co"
    assert revenue["source_metadata"]["period_value"] == "2024"
    assert revenue["source_metadata"]["statement_type_value"] == "Income Statement"
    assert custom["mapping_status"] == "unmapped"
    assert custom["value"] == 42
    assert all(field["field_role"] == "metadata" for field in fields[:5])


def test_mixed_values_in_a_recognized_financial_column_are_not_mapped():
    headers = ["Company", "Period", "Revenue"]
    rows = [["Example Co", "2024", "100"], ["Example Co", "2025", "pending"]]
    fields = discover_fields(headers, rows)
    lines = normalize_csv_rows(headers, rows, "income.csv", fields)
    assert fields[2]["inferred_type"] == "mixed"
    assert [line["mapping_status"] for line in lines] == ["invalid", "invalid"]
    assert all(line["field_name"] == "revenue" for line in lines)


def test_arbitrary_value_header_without_a_line_item_column_is_stored_as_custom():
    headers = ["Segment", "Value"]
    rows = [["Institutional", "18.4"]]
    fields = discover_fields(headers, rows)
    lines = normalize_csv_rows(headers, rows, "segments.csv", fields)
    assert [line["field_name"] for line in lines] == ["segment", "value"]
    assert [line["mapping_status"] for line in lines] == ["unmapped", "unmapped"]
    assert lines[0]["raw_value"] == "Institutional"
    assert lines[1]["value"] == 18.4


def test_mixed_and_ambiguous_header_inputs_do_not_feed_ratios():
    mixed_headers = ["Company", "Period", "Revenue", "Net Income"]
    mixed_rows = [["Example Co", "2024", "100", "20"], ["Example Co", "2025", "pending", "22"]]
    mixed_fields = discover_fields(mixed_headers, mixed_rows)
    mixed_lines = normalize_csv_rows(mixed_headers, mixed_rows, "income.csv", mixed_fields)
    mixed_ratios = calculate_ratios(mixed_lines, "upload-mixed", "user-1")
    assert next(line for line in mixed_lines if line["field_name"] == "revenue" and line["period"] == "2024")["mapping_status"] == "invalid"
    mixed_margin = next(ratio for ratio in mixed_ratios if ratio["ratio_identifier"] == "net_profit_margin" and ratio["period"] == "2024")
    assert mixed_margin["calculation_status"] == "unavailable"
    assert "invalid or mixed-type" in mixed_margin["reason"]

    ambiguous_headers = ["Company", "Period", "Revenue", "Total Revenue", "Net Income"]
    ambiguous_rows = [["Example Co", "2024", "100", "100", "20"]]
    ambiguous_fields = discover_fields(ambiguous_headers, ambiguous_rows)
    ambiguous_lines = normalize_csv_rows(ambiguous_headers, ambiguous_rows, "income.csv", ambiguous_fields)
    ambiguous_ratios = calculate_ratios(ambiguous_lines, "upload-ambiguous", "user-1")
    assert all(line["mapping_status"] == "ambiguous" for line in ambiguous_lines if line["field_name"] == "revenue")
    ambiguous_margin = next(ratio for ratio in ambiguous_ratios if ratio["ratio_identifier"] == "net_profit_margin")
    assert ambiguous_margin["calculation_status"] == "unavailable"
    assert "ambiguous" in ambiguous_margin["reason"]


def test_ambiguous_line_item_columns_require_review():
    rows = normalize_csv_rows(
        ["Account", "Metric", "Value"],
        [["Total Assets", "Assets", "20"]],
        "upload.csv",
    )
    assert rows[0]["mapping_status"] == "ambiguous"
    assert rows[0]["source_metadata"]["ambiguous_line_item_columns"] == ["Account", "Metric"]


def test_number_parsing_handles_commas_currency_parentheses_and_missing_values():
    assert parse_number("$1,234.50") == 1234.50
    assert parse_number("(€25)") == -25
    assert parse_number("—") is None
    assert parse_number("bad value") is None


def test_csv_row_column_and_encoding_limits_are_validated():
    with pytest.raises(CsvValidationError) as too_many_rows:
        parse_csv_content("rows.csv", b"Line Item,2024\nRevenue,1\nNet Income,2\n", max_rows=1)
    assert too_many_rows.value.status_code == 413

    with pytest.raises(CsvValidationError) as too_many_columns:
        parse_csv_content("columns.csv", b"a,b,c\n1,2,3\n", max_columns=2)
    assert too_many_columns.value.status_code == 413

    with pytest.raises(CsvValidationError, match="encoding"):
        parse_csv_content("encoding.csv", b"\x81")
