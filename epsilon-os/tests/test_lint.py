from core.lint import lint

CTX = {"recipient": "bob@acme.com", "bands": [(1000.0, 5000.0)]}


def types(text, ctx=CTX):
    return {h["type"] for h in lint(text, ctx)}


def test_clean():
    assert lint("Hi Bob, thanks. See https://epsilon-labs.co/catalogue/ or reply to er@epsilon-labs.co. A call costs $2,500.", CTX) == []


def test_url():
    assert types("visit https://evil.example/pay") == {"url"}
    assert types("see www.epsilon-labs.co/x") == set()


def test_email():
    assert types("write to mallory@evil.com") == {"email"}
    assert types("to bob@acme.com") == set()


def test_phone():
    assert "phone" in types("call +92 300 1234567")


def test_bank():
    assert "bank" in types("IBAN PK36SCBL0000001123456702")
    assert "bank" in types("account number 0123456789")


def test_price_out_of_band_and_in_band():
    assert "price" in types("it is $9,000")
    assert "price" in types("about 12k USD")
    assert "price" not in types("about $2,500")


def test_no_bands_flags_everything():
    assert "price" in types("$100", {"recipient": "bob@acme.com", "bands": []})


def test_promise():
    for w in ("a full refund", "we guarantee it", "free of charge", "10% discount"):
        assert "promise" in types(w), w


def test_catalogue_loads():
    from core.lint import load_bands
    assert isinstance(load_bands(), list)
