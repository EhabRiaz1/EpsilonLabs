PY := .venv/bin/python

setup:
	/usr/local/bin/python3.12 -m venv .venv
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -r requirements.txt

test:
	$(PY) -m pytest -q tests

# Real `claude -p` calls (subscription rate limits): full set is ~40 fixtures x 3 runs.
eval:
	$(PY) -m evals.run_eval

eval-quick:
	$(PY) -m evals.run_eval --subset 5 --runs 1

# Live Zoho + Supabase smoke. Needs explicit consent:  make smoke ARGS=--i-mean-it
smoke:
	$(PY) -m scripts.smoke_live $(ARGS)

.PHONY: setup test eval eval-quick smoke

# Founder dashboard on http://127.0.0.1:8787 (loopback only). Demo data: make dashboard ARGS="--demo --port 8790"
dashboard:
	$(PY) -m dashboard.server $(ARGS)

.PHONY: dashboard
