from datetime import date
from decimal import Decimal

from django import forms

from home_lab.arca.emission import ExportInvoiceDraft, RecurringExportInvoiceProfile


class RentForm(forms.Form):
    gross_amount = forms.DecimalField(
        label="Alquiler bruto",
        min_value=Decimal("0.01"),
        max_digits=18,
        decimal_places=2,
        widget=forms.NumberInput(attrs={"class": "form-control", "step": "0.01"}),
    )


class StatementUploadForm(forms.Form):
    statement = forms.FileField(
        label="Extracto CSV",
        widget=forms.FileInput(attrs={"class": "form-control", "accept": ".csv,text/csv"}),
    )

    def clean_statement(self):
        statement = self.cleaned_data["statement"]
        if not statement.name.lower().endswith(".csv"):
            raise forms.ValidationError("Seleccioná un archivo CSV.")
        if statement.size > 10 * 1024 * 1024:
            raise forms.ValidationError("El CSV supera el límite de 10 MB.")
        return statement


class ExportInvoiceForm(forms.Form):
    point_of_sale = forms.IntegerField(label="Punto de venta WSFEX", min_value=1)
    issue_date = forms.DateField(label="Fecha de emisión", widget=forms.DateInput(attrs={"type": "date"}))
    payment_date = forms.DateField(label="Fecha de pago declarada", widget=forms.DateInput(attrs={"type": "date"}))
    client_name = forms.CharField(label="Cliente", max_length=200)
    client_address = forms.CharField(label="Domicilio", max_length=300)
    foreign_tax_id = forms.CharField(label="Identificación tributaria extranjera", max_length=100)
    destination_country_code = forms.IntegerField(label="Código WSFEX del país", min_value=1)
    destination_country_tax_id = forms.IntegerField(label="CUIT ARCA del país", min_value=1)
    description = forms.CharField(label="Servicio", widget=forms.Textarea(attrs={"rows": 3}))
    unit_code = forms.IntegerField(label="Código de unidad WSFEX", min_value=1, initial=7)
    amount_usd = forms.DecimalField(label="Importe USD", min_value=Decimal("0.01"), max_digits=18, decimal_places=2)
    exchange_rate = forms.DecimalField(label="Tipo de cambio", min_value=Decimal("0.000001"), max_digits=18, decimal_places=6)
    confirmed = forms.BooleanField(label="Confirmo el envío al sandbox de Afip SDK", required=False)

    def __init__(self, *args, profile: RecurringExportInvoiceProfile | None = None, **kwargs):
        if not args and "initial" not in kwargs:
            initial = {"issue_date": date.today(), "payment_date": date.today()}
            if profile:
                initial.update(
                    {
                        "point_of_sale": profile.point_of_sale,
                        "client_name": profile.client_name,
                        "client_address": profile.client_address,
                        "foreign_tax_id": profile.foreign_tax_id,
                        "destination_country_code": profile.destination_country_code,
                        "destination_country_tax_id": profile.destination_country_tax_id,
                        "description": profile.description,
                        "unit_code": profile.unit_code,
                        "amount_usd": profile.amount_usd,
                    }
                )
            kwargs["initial"] = initial
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs["class"] = "form-check-input" if isinstance(field.widget, forms.CheckboxInput) else "form-control"

    def draft(self) -> ExportInvoiceDraft:
        values = self.cleaned_data
        return ExportInvoiceDraft(
            point_of_sale=values["point_of_sale"],
            issue_date=values["issue_date"],
            payment_date=values["payment_date"],
            client_name=values["client_name"],
            client_address=values["client_address"],
            foreign_tax_id=values["foreign_tax_id"],
            destination_country_code=values["destination_country_code"],
            destination_country_tax_id=values["destination_country_tax_id"],
            description=values["description"],
            unit_code=values["unit_code"],
            amount_usd=values["amount_usd"],
            exchange_rate=values["exchange_rate"],
        )

    def profile(self) -> RecurringExportInvoiceProfile:
        draft = self.draft()
        return RecurringExportInvoiceProfile(
            point_of_sale=draft.point_of_sale,
            client_name=draft.client_name,
            client_address=draft.client_address,
            foreign_tax_id=draft.foreign_tax_id,
            destination_country_code=draft.destination_country_code,
            destination_country_tax_id=draft.destination_country_tax_id,
            description=draft.description,
            unit_code=draft.unit_code,
            amount_usd=draft.amount_usd,
        )
