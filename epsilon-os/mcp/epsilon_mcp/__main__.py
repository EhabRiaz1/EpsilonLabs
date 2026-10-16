"""`python -m epsilon_mcp` (with epsilon-os/mcp on PYTHONPATH) or `python epsilon-os/mcp/run.py`: stdio MCP server."""
import os
import sys

from .api import Api, ConfigError, load_config
from .server import build_server


def main() -> None:
    try:
        cfg = load_config()
    except ConfigError as e:
        # stderr only: stdout is the MCP protocol stream
        print(f"epsilon-mcp: {e}", file=sys.stderr)
        sys.exit(2)
    cwd = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    build_server(Api(cfg), cwd).run("stdio")


if __name__ == "__main__":
    main()
