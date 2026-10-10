PY := .venv/bin/python

setup:
	/usr/local/bin/python3.12 -m venv .venv
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -r requirements.txt

test:
	$(PY) -m pytest -q tests

.PHONY: setup test
