import shlex
import sys


def _secrets_cli(args: list[str]) -> None:
    """CLI for reading secrets: get <key>, export --shell."""
    from backend.codos_utils.secrets import get_secrets_backend

    if not args:
        print("Usage: python -m backend secrets <get KEY | export --shell>", file=sys.stderr)
        sys.exit(1)

    backend = get_secrets_backend()
    subcmd = args[0]

    if subcmd == "get":
        if len(args) < 2:
            print("Usage: python -m backend secrets get <KEY>", file=sys.stderr)
            sys.exit(1)
        value = backend.get(args[1])
        if value is not None:
            print(value)

    elif subcmd == "export":
        for key, value in backend.get_all().items():
            print(f"export {key}={shlex.quote(value)}")

    else:
        print(f"Unknown secrets subcommand: {subcmd}", file=sys.stderr)
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m backend <gateway|telegram-agent|codos-bot|telegram-mcp|secrets>")
        sys.exit(1)
    command = sys.argv[1]
    sys.argv = [sys.argv[0]] + sys.argv[2:]  # strip subcommand

    if command == "gateway":
        from backend.codos_services.gateway.server import run_server

        run_server()
    elif command == "telegram-agent":
        from backend.codos_services.telegram_agent.main import main as ta_main

        ta_main()
    elif command == "codos-bot":
        from backend.codos_services.codos_bot.main import main as cb_main

        cb_main()
    elif command == "crm-update":
        from backend.codos_services.telegram_agent.crm_update import main as crm_main

        crm_main()
    elif command == "telegram-mcp":
        from backend.codos_services.telegram_mcp.main import main as mcp_main

        mcp_main()
    elif command == "secrets":
        _secrets_cli(sys.argv[1:])
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
