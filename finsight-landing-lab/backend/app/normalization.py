from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd


MAPPING_VERSION = "financial-lines-v1"
LINE_ITEM_ALIASES: dict[str, tuple[str, str]] = {}


def _register(field_name: str, statement_type: str, aliases: tuple[str, ...]) -> None:
    for alias in aliases:
        LINE_ITEM_ALIASES[normalize_label(alias)] = (field_name, statement_type)


def normalize_label(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


_register("current_assets", "balance_sheet", ("current assets", "total current assets"))
_register("cash_and_equivalents", "balance_sheet", (
    "cash", "cash and cash equivalents", "cash & cash equivalents", "cash cash equivalents", "cash and equivalents", "cash equivalents",
    "cash and bank balances", "cash and cash equivalents at end of period",
))
_register("accounts_receivable", "balance_sheet", (
    "accounts receivable", "trade receivables", "trade and other receivables", "receivables",
))
_register("inventory", "balance_sheet", ("inventory", "inventories", "stock"))
_register("current_liabilities", "balance_sheet", ("current liabilities", "total current liabilities"))
_register("total_assets", "balance_sheet", ("total assets",))
_register("total_liabilities", "balance_sheet", ("total liabilities",))
_register("total_debt", "balance_sheet", (
    "total debt", "total borrowings", "short and long term debt", "debt and lease obligations",
))
_register("total_equity", "balance_sheet", (
    "total equity", "total shareholders equity", "total stockholders equity", "shareholders funds",
))
_register("revenue", "income_statement", (
    "revenue", "total revenue", "net sales", "sales revenue", "operating revenue", "turnover",
))
_register("cost_of_goods_sold", "income_statement", (
    "cost of goods sold", "cost of sales", "cost of revenue", "cogs",
))
_register("gross_profit", "income_statement", ("gross profit",))
_register("operating_income", "income_statement", (
    "operating income", "operating profit", "ebit", "earnings before interest and taxes",
))
_register("interest_expense", "income_statement", (
    "interest expense", "finance costs", "interest and finance charges",
))
_register("net_income", "income_statement", (
    "net income", "net profit", "profit for the period", "profit after tax", "net earnings",
))
_register("retained_earnings", "balance_sheet", (
    "retained earnings", "accumulated earnings", "retained profits",
))
_register("market_value_of_equity", "other", (
    "market value of equity", "market capitalization", "market cap", "market capitalisation",
))
_register("operating_cash_flow", "cash_flow", (
    "operating cash flow", "cash from operating activities", "net cash from operating activities",
))
_register("shares_outstanding", "other", ("shares outstanding", "weighted average shares outstanding"))
_register("share_price", "other", ("share price", "stock price", "closing share price"))


HEADER_GROUPS = {
    "line_item": {"line_item", "account", "account_name", "description", "particulars", "metric", "field", "item", "name"},
    "value": {"value", "amount", "balance", "reported_value", "amount_value"},
    "period": {"period", "reporting_period", "fiscal_period", "fiscal_year", "reporting_year", "year", "quarter", "date", "as_of", "as_of_date", "reporting_date"},
    "statement_type": {"statement_type", "statement", "financial_statement"},
    "currency": {"currency", "currency_code"},
    "unit": {"unit", "scale", "measurement_unit"},
    "company": {"company", "company_name", "entity", "issuer"},
}
METADATA_HEADERS = set().union(*HEADER_GROUPS.values())


class CsvValidationError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ParsedCsv:
    headers: list[str]
    rows: list[list[str]]
    encoding: str


def decode_csv(content: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return content.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise CsvValidationError("The CSV encoding is not supported. Save it as UTF-8 and upload again.")


def parse_number(raw_value: str) -> Decimal | None:
    text = str(raw_value).strip()
    if not text or text.lower() in {"n/a", "na", "null", "none", "—", "–", "-"}:
        return None

    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1].strip()
    text = "".join(char for char in text if unicodedata.category(char) != "Sc")
    text = text.replace(",", "").replace("\u00a0", "").strip()
    if text.endswith("%"):
        text = text[:-1].strip()
    try:
        number = Decimal(text)
    except InvalidOperation:
        return None
    if not number.is_finite():
        return None
    return -number if negative else number


def parse_currency(raw_value: str) -> str | None:
    for symbol, currency in (("$", "USD"), ("€", "EUR"), ("£", "GBP"), ("₹", "INR"), ("¥", "JPY")):
        if symbol in raw_value:
            return currency
    return None


def parse_period(value: str) -> str | None:
    text = str(value).strip()
    if not text:
        return None
    match = re.fullmatch(r"(?:(?:fy|fiscal\s+year)\s*)?((?:19|20)\d{2})", text, re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.fullmatch(r"((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})", text)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    match = re.fullmatch(r"q([1-4])\s*[-/]?\s*((?:19|20)\d{2})", text, re.IGNORECASE)
    if match:
        return f"{match.group(2)}-Q{match.group(1)}"
    return text


def _period_header(value: str) -> str | None:
    text = str(value).strip()
    if re.fullmatch(r"(?:(?:fy|fiscal\s+year)\s*)?(?:19|20)\d{2}", text, re.IGNORECASE):
        return parse_period(text)
    if re.fullmatch(r"(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}", text):
        return parse_period(text)
    if re.fullmatch(r"q[1-4]\s*[-/]?\s*(?:19|20)\d{2}", text, re.IGNORECASE):
        return parse_period(text)
    return None


def _statement_type(raw_value: str, filename: str, default: str) -> str:
    value = normalize_label(raw_value)
    explicit = {
        "balance_sheet": "balance_sheet", "balance_sheets": "balance_sheet", "bs": "balance_sheet",
        "income_statement": "income_statement", "income_statement_p_and_l": "income_statement",
        "income_statement_profit_loss": "income_statement", "profit_and_loss": "income_statement",
        "p_and_l": "income_statement", "p_l": "income_statement", "income": "income_statement",
        "cash_flow": "cash_flow", "cash_flow_statement": "cash_flow", "cash_flows": "cash_flow",
        "changes_in_equity": "changes_in_equity", "statement_of_changes_in_equity": "changes_in_equity",
        "equity": "changes_in_equity", "notes": "notes", "notes_to_accounts": "notes", "schedule": "other",
    }
    if value in explicit:
        return explicit[value]
    file_text = normalize_label(Path(filename).stem)
    if "balance" in file_text:
        return "balance_sheet"
    if "income" in file_text or "profit_loss" in file_text or "p_and_l" in file_text:
        return "income_statement"
    if "cash_flow" in file_text or "cashflow" in file_text:
        return "cash_flow"
    if "equity" in file_text:
        return "changes_in_equity"
    if "note" in file_text or "schedule" in file_text:
        return "notes"
    return default


def _header_group(header: str) -> str | None:
    normalized = normalize_label(header)
    for group, names in HEADER_GROUPS.items():
        if normalized in names:
            return group
    return None


def _value_type(value: str) -> str:
    text = str(value).strip()
    if not text:
        return "empty"
    if text.casefold() in {"true", "false", "yes", "no"}:
        return "boolean"
    if _period_header(text) and re.fullmatch(r"(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})", text):
        return "date"
    if parse_number(text) is not None:
        return "numeric"
    return "text"


def infer_value_type(values: list[str]) -> str:
    kinds = {_value_type(value) for value in values if str(value).strip()}
    if not kinds:
        return "text"
    return next(iter(kinds)) if len(kinds) == 1 else "mixed"


def discover_fields(headers: list[str], rows: list[list[str]]) -> list[dict[str, Any]]:
    """Describe source columns without changing their original names or values."""
    occurrences: dict[str, int] = {}
    provisional: list[dict[str, Any]] = []
    for ordinal, header in enumerate(headers):
        base = normalize_label(header) or f"column_{ordinal + 1}"
        occurrences[base] = occurrences.get(base, 0) + 1
        candidate = base if occurrences[base] == 1 else f"{base}_{occurrences[base]}"
        group = _header_group(header)
        header_period = _period_header(header)
        if group == "line_item":
            role = "line_item"
        elif group == "value" and not any(_header_group(item) == "line_item" for item in headers):
            role = "metric"
        elif group is not None or header_period is not None:
            role = "metadata"
        else:
            role = "metric"
        column_values = [row[ordinal] if ordinal < len(row) else "" for row in rows]
        inferred_type = infer_value_type(column_values)
        alias = LINE_ITEM_ALIASES.get(normalize_label(header)) if role == "metric" else None
        provisional.append({
            "ordinal": ordinal,
            "source_header": header,
            "candidate_identifier": candidate,
            "canonical_identifier": alias[0] if alias else None,
            "statement_type": alias[1] if alias else None,
            "field_role": role,
            "inferred_type": inferred_type,
            "value_count": sum(bool(str(value).strip()) for value in column_values),
            "mapping_status": "metadata" if role != "metric" else "mapped" if alias else "unmapped",
        })

    # Row-oriented statements also carry their discovered financial fields in the
    # line-item cells rather than in the CSV header row.
    line_item_columns = [index for index, header in enumerate(headers) if _header_group(header) == "line_item"]
    if len(line_item_columns) == 1:
        line_item_index = line_item_columns[0]
        value_columns = [index for index, header in enumerate(headers) if _header_group(header) == "value"]
        period_columns = [index for index, header in enumerate(headers) if _header_group(header) is None and _period_header(header) is not None]
        if len(value_columns) == 1:
            measure_columns = value_columns
        elif period_columns:
            measure_columns = period_columns
        else:
            measure_columns = [
                field["ordinal"] for field in provisional
                if field["field_role"] == "metric"
            ]
        line_items: dict[str, dict[str, Any]] = {}
        for row in rows:
            if line_item_index >= len(row):
                continue
            label = row[line_item_index].strip()
            candidate = normalize_label(label)
            if not candidate:
                continue
            item = line_items.setdefault(candidate, {"label": label, "values": []})
            item["values"].extend(row[index] for index in measure_columns if index < len(row))
        for offset, (candidate, item) in enumerate(line_items.items()):
            alias = LINE_ITEM_ALIASES.get(candidate)
            inferred_type = infer_value_type(item["values"])
            duplicate_periods = len(period_columns) != len({parse_period(headers[index]) for index in period_columns})
            provisional.append({
                "ordinal": len(headers) + offset,
                "source_header": headers[line_item_index],
                "candidate_identifier": candidate,
                "canonical_identifier": alias[0] if alias else None,
                "statement_type": alias[1] if alias else None,
                "field_role": "metric",
                "inferred_type": inferred_type,
                "value_count": sum(bool(str(value).strip()) for value in item["values"]),
                "mapping_status": "ambiguous" if alias and duplicate_periods else "mapped" if alias and inferred_type == "numeric" else "missing" if alias and not any(str(value).strip() for value in item["values"]) else "invalid" if alias else "unmapped",
            })

    canonical_counts: dict[str, int] = {}
    for field in provisional:
        canonical = field["canonical_identifier"]
        if canonical:
            canonical_counts[canonical] = canonical_counts.get(canonical, 0) + 1
    for field in provisional:
        if field["field_role"] != "metric":
            continue
        if field["canonical_identifier"] and canonical_counts[field["canonical_identifier"]] > 1:
            field["mapping_status"] = "ambiguous"
        elif field["canonical_identifier"] and field["value_count"] == 0:
            field["mapping_status"] = "missing"
        elif field["canonical_identifier"] and field["inferred_type"] != "numeric":
            field["mapping_status"] = "invalid"
    return provisional


def _find_column(headers: list[str], group: str) -> int | None:
    matches = [index for index, header in enumerate(headers) if _header_group(header) == group]
    return matches[0] if len(matches) == 1 else None


def extract_company_name(headers: list[str], rows: list[list[str]]) -> str | None:
    index = _find_column(headers, "company")
    if index is None:
        return None
    return next((row[index].strip() for row in rows if index < len(row) and row[index].strip()), None)


def normalize_csv_rows(
    headers: list[str],
    rows: list[list[str]],
    filename: str,
    discovered_fields: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    fields = discovered_fields or discover_fields(headers, rows)
    fields_by_index = {field["ordinal"]: field for field in fields if field["ordinal"] < len(headers)}
    line_item_indices = [index for index, field in fields_by_index.items() if field["field_role"] == "line_item"]
    ambiguous_layout = len(line_item_indices) > 1
    line_item_index = line_item_indices[0] if line_item_indices else None
    value_index = _find_column(headers, "value")
    period_index = _find_column(headers, "period")
    statement_index = _find_column(headers, "statement_type")
    currency_index = _find_column(headers, "currency")
    unit_index = _find_column(headers, "unit")
    company_index = _find_column(headers, "company")
    period_columns = [(index, parse_period(header)) for index, header in enumerate(headers) if _header_group(header) is None and _period_header(header) is not None]
    context_indices = {index for index, field in fields_by_index.items() if field["field_role"] != "metric"}

    if line_item_index is not None:
        if value_index is not None:
            item_measure_columns = [(value_index, None)]
        elif period_columns:
            item_measure_columns = period_columns
        else:
            item_measure_columns = []
    else:
        item_measure_columns = []
    header_measure_indices = [
        index for index in fields_by_index
        if fields_by_index[index]["field_role"] == "metric"
        and not (line_item_index is not None and index == value_index)
    ]

    output: list[dict[str, Any]] = []
    row_item_types: dict[str, str] = {}
    if line_item_index is not None:
        grouped_values: dict[str, list[str]] = {}
        selected_measure_indices = [index for index, _ in item_measure_columns] or ([value_index] if value_index is not None else header_measure_indices)
        for row in rows:
            if line_item_index >= len(row):
                continue
            label = row[line_item_index].strip()
            key = normalize_label(label)
            if not key:
                continue
            grouped_values.setdefault(key, []).extend(row[index] for index in selected_measure_indices if index is not None and index < len(row))
        row_item_types = {key: infer_value_type(values) for key, values in grouped_values.items()}

    def append_field(
        *, row: list[str], row_number: int, field_name: str, alias: tuple[str, str] | None,
        raw_index: int, period: str | None, candidate_identifier: str, inferred_type: str,
        schema_status: str, source_header: str, original_label: str | None = None,
    ) -> None:
        raw_value = row[raw_index] if raw_index < len(row) else ""
        parsed_number = parse_number(raw_value)
        statement_value = row[statement_index] if statement_index is not None and statement_index < len(row) else ""
        default_statement = alias[1] if alias else "other"
        statement_type = _statement_type(statement_value, filename, default_statement)
        company = row[company_index].strip() if company_index is not None and company_index < len(row) else None
        currency = row[currency_index].strip().upper() if currency_index is not None and currency_index < len(row) else ""
        unit = row[unit_index].strip().lower() if unit_index is not None and unit_index < len(row) else ""
        if alias is not None:
            field_name = alias[0]
            if schema_status == "ambiguous" or ambiguous_layout:
                status = "ambiguous"
            elif not raw_value.strip():
                status = "missing"
            elif inferred_type != "numeric":
                status = "invalid"
            elif parsed_number is None:
                status = "invalid"
            else:
                status = "mapped"
        else:
            status = "unmapped"
        metadata = {
            "source_header": source_header,
            "candidate_identifier": candidate_identifier,
            "canonical_identifier": alias[0] if alias else None,
            "inferred_type": inferred_type,
            "field_role": "metric",
            "mapping_strategy": "registered_alias" if alias else "custom_unmapped",
            "original_label": original_label,
            "company": company,
            "period_value": parse_period(row[period_index]) if period_index is not None and period_index < len(row) else period,
            "statement_type_value": statement_value,
            "currency_value": currency or parse_currency(raw_value),
            "unit_value": unit or None,
            "currency_source": headers[currency_index] if currency_index is not None else None,
            "unit_source": headers[unit_index] if unit_index is not None else None,
            "period_source": headers[period_index] if period_index is not None else source_header if _period_header(source_header) else None,
            "statement_type_source": headers[statement_index] if statement_index is not None else None,
            "ambiguous_line_item_columns": [headers[index] for index in line_item_indices] if ambiguous_layout else [],
        }
        output.append({
            "statement_type": statement_type,
            "field_name": field_name,
            "value": float(parsed_number) if parsed_number is not None else None,
            "raw_value": raw_value,
            "period": parse_period(row[period_index]) if period_index is not None and period_index < len(row) and row[period_index].strip() else period,
            "period_kind": "instant" if statement_type == "balance_sheet" else "duration" if statement_type in {"income_statement", "cash_flow", "changes_in_equity"} else "unknown",
            "currency": currency or parse_currency(raw_value),
            "unit": unit or None,
            "source_column": source_header,
            "source_row_number": row_number,
            "mapping_status": status,
            "mapping_version": MAPPING_VERSION,
            "source_metadata": metadata,
        })

    for row_number, row in enumerate(rows, start=2):
        row = row + [""] * max(0, len(headers) - len(row))
        if not any(str(value).strip() for value in row):
            continue
        if line_item_index is not None:
            label = row[line_item_index].strip()
            alias = LINE_ITEM_ALIASES.get(normalize_label(label))
            candidate = normalize_label(label) or "unlabeled_line"
            if item_measure_columns:
                for measure_index, header_period in item_measure_columns:
                    inferred = row_item_types.get(normalize_label(label), "text")
                    append_field(row=row, row_number=row_number, field_name=candidate, alias=alias,
                                 raw_index=measure_index, period=header_period, candidate_identifier=candidate,
                                 inferred_type=inferred, schema_status="ambiguous" if ambiguous_layout else "mapped" if alias else "unmapped",
                                 source_header=headers[measure_index], original_label=label)
            # Additional source columns beside row labels are stored as their own custom fields.
            ignored = context_indices | {line_item_index, value_index}
            if item_measure_columns:
                ignored |= {index for index, _ in item_measure_columns}
            for index in header_measure_indices:
                if index in ignored:
                    continue
                field = fields_by_index[index]
                append_field(row=row, row_number=row_number, field_name=field["candidate_identifier"],
                             alias=LINE_ITEM_ALIASES.get(normalize_label(headers[index])), raw_index=index,
                             period=None, candidate_identifier=field["candidate_identifier"],
                             inferred_type=field["inferred_type"], schema_status=field["mapping_status"],
                             source_header=headers[index])
        else:
            for index in header_measure_indices:
                field = fields_by_index[index]
                append_field(row=row, row_number=row_number, field_name=field["candidate_identifier"],
                             alias=LINE_ITEM_ALIASES.get(normalize_label(headers[index])), raw_index=index,
                             period=None, candidate_identifier=field["candidate_identifier"],
                             inferred_type=field["inferred_type"], schema_status=field["mapping_status"],
                             source_header=headers[index])

    duplicate_fields: dict[tuple[str, str | None, int], list[dict[str, Any]]] = {}
    for line in output:
        if line["mapping_status"] == "mapped":
            key = (line["field_name"], line["period"], line["source_row_number"])
            duplicate_fields.setdefault(key, []).append(line)
    for duplicates in duplicate_fields.values():
        if len(duplicates) > 1:
            for line in duplicates:
                line["mapping_status"] = "ambiguous"
    return output


def parse_csv_content(
    filename: str,
    content: bytes,
    max_rows: int = 20_000,
    max_columns: int = 150,
) -> ParsedCsv:
    if not filename.lower().endswith(".csv"):
        raise CsvValidationError("Upload a .csv file.")
    if not content:
        raise CsvValidationError("The CSV file is empty.")
    text, encoding = decode_csv(content)
    try:
        frame = pd.read_csv(
            io.StringIO(text),
            header=None,
            dtype=str,
            keep_default_na=False,
            skip_blank_lines=False,
            engine="python",
            on_bad_lines="error",
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, ValueError) as exc:
        raise CsvValidationError("The file is not a valid rectangular CSV. Check its quoting and row lengths.") from exc
    if frame.empty or frame.shape[1] == 0:
        raise CsvValidationError("The CSV needs a header row and at least one data row.")
    if frame.shape[1] > max_columns:
        raise CsvValidationError(f"The CSV exceeds the {max_columns}-column limit.", status_code=413)
    data_rows = frame.iloc[1:]
    if len(data_rows) > max_rows:
        raise CsvValidationError(f"The CSV exceeds the {max_rows}-row limit.", status_code=413)
    headers = [str(value) for value in frame.iloc[0].tolist()]
    rows = [[str(value) for value in row] for row in data_rows.itertuples(index=False, name=None)]
    if not any(any(value.strip() for value in row) for row in rows):
        raise CsvValidationError("The CSV contains a header but no data rows.")
    return ParsedCsv(headers, rows, encoding)
