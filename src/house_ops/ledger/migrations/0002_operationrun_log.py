from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ledger", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="operationrun",
            name="log",
            field=models.TextField(blank=True),
        ),
    ]
