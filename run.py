#!/usr/bin/env python3
"""Run Seqta Link development server."""
import os

from dotenv import load_dotenv

load_dotenv()

from seqta_link import create_app

app = create_app()

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "3210"))
    app.run(host=host, port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
