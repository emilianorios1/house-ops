from decimal import Decimal, InvalidOperation

from django import template


register = template.Library()


@register.filter
def ars(value: object) -> str:
    if value in (None, ""):
        return "—"
    try:
        number = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return "—"
    formatted = f"{number:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"$ {formatted}"


@register.filter
def month_value(value) -> str:
    return value.strftime("%Y-%m") if value else ""


@register.filter
def date_ar(value) -> str:
    return value.strftime("%d/%m/%Y") if value else "—"


@register.filter
def lookup(mapping, key):
    return mapping.get(key, key) if mapping else key
