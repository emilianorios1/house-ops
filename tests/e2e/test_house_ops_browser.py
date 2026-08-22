from __future__ import annotations

import os
from datetime import date
from uuid import uuid4

import pytest
from playwright.sync_api import Page, expect

from house_ops.work.recurrence import add_months


BASE_URL = os.getenv("HOUSE_OPS_E2E_BASE_URL", "").rstrip("/")
USERNAME = os.getenv("HOUSE_OPS_E2E_USERNAME", "")
PASSWORD = os.getenv("HOUSE_OPS_E2E_PASSWORD", "")

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        not all((BASE_URL, USERNAME, PASSWORD)),
        reason="Set HOUSE_OPS_E2E_BASE_URL, HOUSE_OPS_E2E_USERNAME and HOUSE_OPS_E2E_PASSWORD",
    ),
]


@pytest.fixture
def page():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        yield page
        context.close()
        browser.close()


def login(page: Page) -> None:
    page.goto(f"{BASE_URL}/login/")
    page.get_by_label("Usuario").fill(USERNAME)
    page.get_by_label("Contraseña").fill(PASSWORD)
    page.get_by_role("button", name="Entrar").click()
    expect(page.get_by_role("heading", name="¿Qué necesita atención?")).to_be_visible()


def test_critical_house_ops_flows_and_mobile_layout(page: Page) -> None:
    login(page)

    ant_card = page.locator("article", has_text="Poner veneno para hormigas")
    if ant_card.get_by_role("button", name="Hecho").is_visible():
        ant_card.get_by_role("button", name="Hecho").click()
        expect(page.locator("article", has_text="Poner veneno para hormigas")).to_have_count(0)

    page.goto(f"{BASE_URL}/tasks/routines/")
    routine_card = page.locator("article", has_text="Poner veneno para hormigas")
    expect(routine_card).to_be_visible()
    expected_due = add_months(date.today(), 1).strftime("%d/%m/%Y")
    expect(routine_card).to_contain_text(expected_due)

    title = f"Smoke House Ops {uuid4().hex[:8]}"
    page.goto(f"{BASE_URL}/tasks/new/")
    page.get_by_label("Tarea").fill(title)
    page.get_by_role("button", name="Guardar").click()
    inbox_card = page.locator("article", has_text=title)
    expect(inbox_card).to_be_visible()
    inbox_card.get_by_role("button", name="Doing").click()
    doing_card = page.locator("article", has_text=title)
    expect(doing_card).to_be_visible()
    doing_card.get_by_role("button", name="Done").click()
    expect(page.locator("article", has_text=title)).to_be_visible()

    for path, heading in (
        ("/ledger/", "Ledger"),
        ("/ledger/shared-expenses/", "Gastos compartidos"),
        ("/ledger/credit-cards/", "Tarjeta Naranja"),
        ("/documents/", "Documentos"),
        ("/operations/", "Operaciones"),
    ):
        page.goto(f"{BASE_URL}{path}")
        expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()

    page.goto(f"{BASE_URL}/")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    expect(page.locator(".navbar-toggler")).to_be_visible()
    assert page.evaluate("typeof htmx !== 'undefined'")
    custom_css = page.locator("link[href*='house_ops/app']").get_attribute("href")
    assert custom_css
    assert page.request.get(f"{BASE_URL}{custom_css}").ok
    assert page.locator(".metric-card span").first.evaluate(
        "element => getComputedStyle(element).display === 'block'"
    )
    quick_card = page.locator(".quick-card").bounding_box()
    finance_heading = page.get_by_role("heading", name="Resumen financiero del mes").bounding_box()
    assert quick_card and finance_heading
    assert quick_card["y"] + quick_card["height"] <= finance_heading["y"]
    assert page.locator(".btn-primary").first.evaluate(
        "element => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)'"
    )
