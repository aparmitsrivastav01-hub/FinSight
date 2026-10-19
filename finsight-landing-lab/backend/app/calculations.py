from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable


FORMULA_VERSION = "deterministic-ratios-v1"
RATIO_DEFINITIONS = {
    "current_ratio": "Current assets / current liabilities",
    "quick_ratio": "(Current assets - inventory) / current liabilities",
    "cash_ratio": "Cash and cash equivalents / current liabilities",
    "working_capital": "Current assets - current liabilities",
    "debt_to_equity": "Total debt / total equity; total liabilities are not substituted for total debt",
    "debt_to_assets": "Total debt / total assets",
    "interest_coverage": "Operating income (EBIT) / interest expense",
    "gross_profit_margin": "Gross profit / revenue; gross profit may be derived as revenue - cost of goods sold",
    "operating_margin": "Operating income (EBIT) / revenue",
    "net_profit_margin": "Net income / revenue",
    "return_on_assets": "Net income / average total assets across consecutive reporting periods",
    "return_on_equity": "Net income / average total equity across consecutive reporting periods",
    "inventory_turnover": "Cost of goods sold / average inventory across consecutive reporting periods",
    "receivables_turnover": "Revenue / average accounts receivable across consecutive reporting periods",
    "asset_turnover": "Revenue / average total assets across consecutive reporting periods",
}


def _period_order(period: str | None) -> tuple[int, int, str]:
    text = period or ""
    quarter = re.search(r"((?:19|20)\d{2})-Q([1-4])", text, re.IGNORECASE)
    if quarter:
        return int(quarter.group(1)), int(quarter.group(2)), text
    date = re.fullmatch(r"((?:19|20)\d{2})-(\d{2})-\d{2}", text)
    if date:
        return int(date.group(1)), int(date.group(2)), text
    year = re.search(r"(?:19|20)\d{2}", text)
    if year:
        return int(year.group(0)), 12, text
    return -1, -1, text


def _consecutive(previous: str | None, current: str | None) -> bool:
    if not previous or not current:
        return False
    prev_quarter = re.fullmatch(r"((?:19|20)\d{2})-Q([1-4])", previous, re.IGNORECASE)
    cur_quarter = re.fullmatch(r"((?:19|20)\d{2})-Q([1-4])", current, re.IGNORECASE)
    if prev_quarter and cur_quarter:
        return (int(cur_quarter.group(1)) * 4 + int(cur_quarter.group(2))) - (
            int(prev_quarter.group(1)) * 4 + int(prev_quarter.group(2))
        ) == 1
    prev_date = re.fullmatch(r"((?:19|20)\d{2})-(\d{2})-\d{2}", previous)
    cur_date = re.fullmatch(r"((?:19|20)\d{2})-(\d{2})-\d{2}", current)
    if prev_date and cur_date:
        month_delta = (int(cur_date.group(1)) - int(prev_date.group(1))) * 12 + (
            int(cur_date.group(2)) - int(prev_date.group(2))
        )
        return month_delta in {1, 3, 12}
    prev_year = re.search(r"(?:19|20)\d{2}", previous)
    cur_year = re.search(r"(?:19|20)\d{2}", current)
    return bool(prev_year and cur_year and int(cur_year.group(0)) - int(prev_year.group(0)) == 1)


def calculate_ratios(
    lines: list[dict[str, Any]],
    upload_id: str,
    user_id: str,
    company_name: str | None = None,
) -> list[dict[str, Any]]:
    periods = sorted({line.get("period") for line in lines}, key=_period_order)
    if not periods:
        periods = [None]

    def input_record(
        field_name: str,
        statement_type: str,
        period: str | None,
    ) -> tuple[dict[str, Any] | None, str | None]:
        source_candidates = [
            line for line in lines
            if line.get("field_name") == field_name
            and line.get("statement_type") == statement_type
            and line.get("period") == period
        ]
        candidates = [
            line for line in source_candidates
            if line.get("mapping_status") == "mapped"
            and line.get("value") is not None
        ]
        if len(candidates) > 1:
            return None, f"Input '{field_name}' is ambiguous because multiple rows map to it for this period."
        if candidates:
            return candidates[0], None
        statuses = {line.get("mapping_status") for line in source_candidates}
        if "ambiguous" in statuses:
            return None, f"Input '{field_name}' is ambiguous and requires mapping review for this period."
        if "invalid" in statuses:
            return None, f"Input '{field_name}' contains invalid or mixed-type values for this period."
        if "missing" in statuses:
            return None, f"Input '{field_name}' is missing for this period."
        if "unmapped" in statuses:
            return None, f"Input '{field_name}' is present but not confidently mapped for this period."
        return None, f"Required input '{field_name}' is missing or not mapped for this period."

    def result_row(
        identifier: str,
        period: str | None,
        unit: str,
        inputs: list[dict[str, Any]],
        reason: str | None,
        operation: Callable[[list[float]], float] | None,
        *,
        zero_denominator: bool = False,
    ) -> dict[str, Any]:
        calculated_value = None
        status = "unavailable"
        if reason is None:
            currencies = {item.get("currency") for item in inputs}
            units = {item.get("unit") for item in inputs}
            if len(currencies) > 1 or len(units) > 1:
                reason = "Input currencies or units do not match."
                status = "unavailable"
            elif any(value is None for value in currencies) and len(currencies) > 1:
                reason = "Currency metadata is incomplete across ratio inputs."
                status = "unavailable"
            elif any(value is None for value in units) and len(units) > 1:
                reason = "Unit metadata is incomplete across ratio inputs."
                status = "unavailable"
            else:
                values = [float(item["value"]) for item in inputs]
                if zero_denominator and values[-1] == 0:
                    reason = "The denominator is zero."
                    status = "invalid"
                else:
                    try:
                        calculated_value = operation(values) if operation else None
                        if calculated_value is None:
                            reason = "The calculation could not be completed from the available inputs."
                        else:
                            status = "calculated"
                    except (ArithmeticError, OverflowError, ValueError):
                        reason = "The calculation produced an invalid numeric result."
                        status = "invalid"

        return {
            "source_upload_id": upload_id,
            "user_id": user_id,
            "company_name": company_name,
            "period": period,
            "ratio_identifier": identifier,
            "calculated_value": calculated_value,
            "unit": unit,
            "calculation_status": status,
            "formula_version": FORMULA_VERSION,
            "calculated_at": datetime.now(timezone.utc).isoformat(),
            "input_values": [
                {
                    "field_name": item.get("field_name"),
                    "statement_type": item.get("statement_type"),
                    "period": item.get("period"),
                    "value": item.get("value"),
                    "currency": item.get("currency"),
                    "unit": item.get("unit"),
                    "source_column": item.get("source_column"),
                    "source_row_number": item.get("source_row_number"),
                }
                for item in inputs
            ],
            "reason": reason,
        }

    definitions = [
        ("current_ratio", "x", [("current_assets", "balance_sheet")], [("current_liabilities", "balance_sheet")], lambda v: v[0] / v[1], True),
        ("quick_ratio", "x", [("current_assets", "balance_sheet"), ("inventory", "balance_sheet")], [("current_liabilities", "balance_sheet")], lambda v: (v[0] - v[1]) / v[2], True),
        ("cash_ratio", "x", [("cash_and_equivalents", "balance_sheet")], [("current_liabilities", "balance_sheet")], lambda v: v[0] / v[1], True),
        ("working_capital", "currency", [("current_assets", "balance_sheet"), ("current_liabilities", "balance_sheet")], [], lambda v: v[0] - v[1], False),
        ("debt_to_equity", "x", [("total_debt", "balance_sheet")], [("total_equity", "balance_sheet")], lambda v: v[0] / v[1], True),
        ("debt_to_assets", "x", [("total_debt", "balance_sheet")], [("total_assets", "balance_sheet")], lambda v: v[0] / v[1], True),
        ("interest_coverage", "x", [("operating_income", "income_statement")], [("interest_expense", "income_statement")], lambda v: v[0] / v[1], True),
        ("operating_margin", "%", [("operating_income", "income_statement")], [("revenue", "income_statement")], lambda v: v[0] / v[1] * 100, True),
        ("net_profit_margin", "%", [("net_income", "income_statement")], [("revenue", "income_statement")], lambda v: v[0] / v[1] * 100, True),
    ]

    results: list[dict[str, Any]] = []
    period_index = {period: index for index, period in enumerate(periods)}
    for period in periods:
        for identifier, unit, numerator_fields, denominator_fields, operation, check_zero in definitions:
            specs = numerator_fields + denominator_fields
            inputs: list[dict[str, Any]] = []
            reason = None
            for field_name, statement_type in specs:
                item, missing_reason = input_record(field_name, statement_type, period)
                if missing_reason:
                    reason = missing_reason
                    break
                inputs.append(item)
            result_unit = unit
            if identifier == "working_capital" and inputs:
                result_unit = " ".join(part for part in (inputs[0].get("currency"), inputs[0].get("unit")) if part) or "currency"
            results.append(result_row(identifier, period, result_unit, inputs, reason, operation, zero_denominator=check_zero))

        revenue, revenue_error = input_record("revenue", "income_statement", period)
        gross_profit, gross_error = input_record("gross_profit", "income_statement", period)
        cogs, cogs_error = input_record("cost_of_goods_sold", "income_statement", period)
        if gross_error and revenue is not None and cogs is not None and not cogs_error:
            results.append(result_row(
                "gross_profit_margin", period, "%", [cogs, revenue], None,
                lambda values: (values[1] - values[0]) / values[1] * 100,
                zero_denominator=True,
            ))
        else:
            gross_reason = revenue_error or (gross_error if gross_profit is None else None)
            gross_inputs = [item for item in (gross_profit, revenue) if item is not None]
            results.append(result_row(
                "gross_profit_margin", period, "%", gross_inputs, gross_reason,
                lambda values: values[0] / values[1] * 100,
                zero_denominator=True,
            ))

        current_period_index = period_index[period]
        previous_period = periods[current_period_index - 1] if current_period_index > 0 else None
        can_average = _consecutive(previous_period, period)
        average_definitions = [
            ("return_on_assets", "net_income", "income_statement", "total_assets", "balance_sheet"),
            ("return_on_equity", "net_income", "income_statement", "total_equity", "balance_sheet"),
            ("inventory_turnover", "cost_of_goods_sold", "income_statement", "inventory", "balance_sheet"),
            ("receivables_turnover", "revenue", "income_statement", "accounts_receivable", "balance_sheet"),
            ("asset_turnover", "revenue", "income_statement", "total_assets", "balance_sheet"),
        ]
        for identifier, numerator_name, numerator_statement, balance_name, balance_statement in average_definitions:
            numerator, numerator_error = input_record(numerator_name, numerator_statement, period)
            current_balance, current_error = input_record(balance_name, balance_statement, period)
            previous_balance = None
            previous_error = None
            if can_average:
                previous_balance, previous_error = input_record(balance_name, balance_statement, previous_period)
            if not can_average:
                reason = f"A consecutive prior reporting period is required to calculate average {balance_name.replace('_', ' ')}."
            else:
                reason = numerator_error or current_error or previous_error
            inputs = [item for item in (numerator, current_balance, previous_balance) if item is not None]
            operation = lambda values: values[0] / ((values[1] + values[2]) / 2) * (100 if identifier in {"return_on_assets", "return_on_equity"} else 1)
            results.append(result_row(
                identifier,
                period,
                "%" if identifier in {"return_on_assets", "return_on_equity"} else "x",
                inputs,
                reason,
                operation,
                zero_denominator=True,
            ))

    return results
