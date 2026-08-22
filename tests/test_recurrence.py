from datetime import date

import pytest

from house_ops.work.recurrence import add_months, next_occurrence


@pytest.mark.parametrize(
    ("value", "months", "expected"),
    [
        (date(2026, 1, 31), 1, date(2026, 2, 28)),
        (date(2028, 1, 31), 1, date(2028, 2, 29)),
        (date(2026, 12, 31), 2, date(2027, 2, 28)),
    ],
)
def test_add_months_clamps_to_the_last_valid_day(value: date, months: int, expected: date) -> None:
    assert add_months(value, months) == expected


@pytest.mark.parametrize(
    ("recurrence", "interval", "expected"),
    [
        ("days", 10, date(2026, 2, 10)),
        ("weeks", 2, date(2026, 2, 14)),
        ("months", 1, date(2026, 2, 28)),
        ("years", 1, date(2027, 1, 31)),
    ],
)
def test_next_occurrence_supports_domestic_recurrences(
    recurrence: str,
    interval: int,
    expected: date,
) -> None:
    assert next_occurrence(recurrence, interval, date(2026, 1, 31)) == expected


@pytest.mark.parametrize(("recurrence", "interval"), [("months", 0), ("unknown", 1)])
def test_next_occurrence_rejects_invalid_configuration(recurrence: str, interval: int) -> None:
    with pytest.raises(ValueError):
        next_occurrence(recurrence, interval, date(2026, 1, 1))
