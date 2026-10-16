"""Entry point for `claude mcp add`: <epsilon-os>/.venv/bin/python <epsilon-os>/mcp/run.py
Python puts this file's folder first on sys.path, so `epsilon_mcp` imports without PYTHONPATH."""
from epsilon_mcp.__main__ import main

if __name__ == "__main__":
    main()
