import sys


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m backend <connector|telegram-agent|atlas-bot|telegram-mcp>")
        sys.exit(1)
    command = sys.argv[1]
    sys.argv = [sys.argv[0]] + sys.argv[2:]  # strip subcommand

    if command == "connector":
        from backend.connector.server import run_server

        run_server()
    elif command == "telegram-agent":
        from backend.telegram_agent.main import main as ta_main

        ta_main()
    elif command == "atlas-bot":
        from backend.atlas_bot.main import main as ab_main

        ab_main()
    elif command == "crm-update":
        from backend.telegram_agent.crm_update import main as crm_main

        crm_main()
    elif command == "telegram-mcp":
        from backend.telegram_mcp.main import main as mcp_main

        mcp_main()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
