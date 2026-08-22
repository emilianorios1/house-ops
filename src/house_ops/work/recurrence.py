"""Small, deterministic recurrence calculations."""

from calendar import monthrange
from datetime import date, timedelta


def add_months(value: date, months: int) -> date:
    if months < 1:
        raise ValueError("months must be positive")
    zero_based = value.year * 12 + value.month - 1 + months
    year, month_index = divmod(zero_based, 12)
    month = month_index + 1
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def next_occurrence(recurrence: str, interval: int, from_date: date) -> date:
    if interval < 1:
        raise ValueError("interval must be positive")
    if recurrence == "days":
        return from_date + timedelta(days=interval)
    if recurrence == "weeks":
        return from_date + timedelta(weeks=interval)
    if recurrence == "months":
        return add_months(from_date, interval)
    if recurrence == "years":
        return add_months(from_date, interval * 12)
    raise ValueError(f"Unsupported recurrence: {recurrence}")
