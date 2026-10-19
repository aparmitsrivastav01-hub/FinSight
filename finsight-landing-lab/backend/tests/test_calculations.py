from app.calculations import calculate_ratios


def line(field, statement, period, value, row, *, currency="USD", unit="millions", status="mapped"):
    return {
        "field_name": field,
        "statement_type": statement,
        "period": period,
        "value": value,
        "currency": currency,
        "unit": unit,
        "mapping_status": status,
        "source_column": period,
        "source_row_number": row,
    }


def result_map(results, period="2024"):
    return {result["ratio_identifier"]: result for result in results if result["period"] == period}


def test_ratio_formulas_and_lineage_use_aligned_period_inputs():
    rows = [
        line("total_assets", "balance_sheet", "2023", 400, 2),
        line("total_assets", "balance_sheet", "2024", 500, 2),
        line("total_equity", "balance_sheet", "2023", 200, 3),
        line("total_equity", "balance_sheet", "2024", 250, 3),
        line("current_assets", "balance_sheet", "2024", 120, 4),
        line("cash_and_equivalents", "balance_sheet", "2024", 30, 5),
        line("accounts_receivable", "balance_sheet", "2023", 40, 6),
        line("accounts_receivable", "balance_sheet", "2024", 60, 6),
        line("inventory", "balance_sheet", "2023", 20, 7),
        line("inventory", "balance_sheet", "2024", 30, 7),
        line("current_liabilities", "balance_sheet", "2024", 60, 8),
        line("total_debt", "balance_sheet", "2024", 100, 9),
        line("total_liabilities", "balance_sheet", "2024", 300, 10),
        line("revenue", "income_statement", "2024", 400, 11),
        line("cost_of_goods_sold", "income_statement", "2024", 200, 12),
        line("operating_income", "income_statement", "2024", 80, 13),
        line("interest_expense", "income_statement", "2024", 20, 14),
        line("net_income", "income_statement", "2024", 40, 15),
    ]

    result = result_map(calculate_ratios(rows, "upload-1", "user-1", "Example Co"))
    assert result["current_ratio"]["calculated_value"] == 2
    assert result["quick_ratio"]["calculated_value"] == 1.5
    assert result["cash_ratio"]["calculated_value"] == 0.5
    assert result["working_capital"]["calculated_value"] == 60
    assert result["debt_to_equity"]["calculated_value"] == 0.4
    assert result["debt_to_assets"]["calculated_value"] == 0.2
    assert result["interest_coverage"]["calculated_value"] == 4
    assert result["gross_profit_margin"]["calculated_value"] == 50
    assert result["operating_margin"]["calculated_value"] == 20
    assert result["net_profit_margin"]["calculated_value"] == 10
    assert result["return_on_assets"]["calculated_value"] == 40 / 450 * 100
    assert result["return_on_equity"]["calculated_value"] == 40 / 225 * 100
    assert result["inventory_turnover"]["calculated_value"] == 200 / 25
    assert result["receivables_turnover"]["calculated_value"] == 400 / 50
    assert result["asset_turnover"]["calculated_value"] == 400 / 450
    assert result["debt_to_equity"]["input_values"][0]["field_name"] == "total_debt"
    assert result["return_on_assets"]["input_values"][1]["source_row_number"] == 2


def test_missing_ambiguous_and_zero_denominator_inputs_are_not_fabricated():
    rows = [
        line("current_assets", "balance_sheet", "2024", 10, 2),
        line("current_liabilities", "balance_sheet", "2024", 0, 3),
        line("total_debt", "balance_sheet", "2024", 5, 4, status="ambiguous"),
        line("revenue", "income_statement", "2024", 50, 5),
    ]
    results = result_map(calculate_ratios(rows, "upload-2", "user-1"))
    assert results["current_ratio"]["calculation_status"] == "invalid"
    assert results["current_ratio"]["reason"] == "The denominator is zero."
    assert results["quick_ratio"]["calculation_status"] == "unavailable"
    assert results["debt_to_equity"]["calculation_status"] == "unavailable"
    assert results["debt_to_equity"]["calculated_value"] is None


def test_average_based_ratios_require_consecutive_comparable_periods():
    rows = [
        line("total_assets", "balance_sheet", "2022", 100, 2),
        line("total_assets", "balance_sheet", "2024", 200, 2),
        line("net_income", "income_statement", "2024", 20, 3),
    ]
    result = result_map(calculate_ratios(rows, "upload-3", "user-1"))
    assert result["return_on_assets"]["calculation_status"] == "unavailable"
    assert "consecutive prior" in result["return_on_assets"]["reason"]


def test_ratio_inputs_with_mismatched_currencies_are_unavailable():
    rows = [
        line("current_assets", "balance_sheet", "2024", 100, 2, currency="USD"),
        line("current_liabilities", "balance_sheet", "2024", 50, 3, currency="EUR"),
    ]
    result = result_map(calculate_ratios(rows, "upload-4", "user-1"))
    assert result["current_ratio"]["calculation_status"] == "unavailable"
    assert result["current_ratio"]["reason"] == "Input currencies or units do not match."


def test_average_balance_ratios_accept_consecutive_period_end_dates():
    rows = [
        line("total_assets", "balance_sheet", "2024-03-31", 100, 2),
        line("total_assets", "balance_sheet", "2024-06-30", 120, 2),
        line("net_income", "income_statement", "2024-06-30", 11, 3),
    ]
    result = result_map(calculate_ratios(rows, "upload-5", "user-1"), period="2024-06-30")
    assert result["return_on_assets"]["calculated_value"] == 11 / 110 * 100
