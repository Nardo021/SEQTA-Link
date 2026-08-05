"""CLI entry point."""
import sys

from dotenv import load_dotenv

load_dotenv()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        from run import app

        import os

        app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "3210")))
        return

    from seqta_link import create_app

    app = create_app()
    app.cli.main(args=sys.argv[1:] if len(sys.argv) > 1 else None)


if __name__ == "__main__":
    main()
