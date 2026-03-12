#!/usr/bin/env python3
"""
Gemini Deep Research via Browser Automation

Uses Playwright to control Chrome and interact with Gemini Deep Research.
Free with Google Workspace subscription.
"""

import argparse
import asyncio
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    from playwright.async_api import TimeoutError as PlaywrightTimeout
    from playwright.async_api import async_playwright
except ImportError:
    print("Error: playwright not installed. Run: pip3 install playwright")
    sys.exit(1)

try:
    import html2text
except ImportError:
    print("Error: html2text not installed. Run: pip3 install html2text")
    sys.exit(1)


CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_DEBUG_PORT = 9222
GEMINI_URL = "https://gemini.google.com/app"
DEFAULT_OUTPUT_DIR = (
    Path(os.environ.get("VAULT_PATH", str(Path.home() / "Documents" / "Vault"))) / "2 - Projects" / "Research"
)
POLL_INTERVAL = 30  # seconds between completion checks
STEP_RETRIES = 3
STEP_BACKOFF_BASE = 1.5

SELECTORS = {
    "input": [
        'div[contenteditable="true"]',
        'textarea[aria-label*="prompt"]',
        "textarea",
        ".ql-editor",
    ],
    "deep_research": [
        'button:has-text("Deep Research")',
        '[data-test-id="deep-research"]',
        'text="Deep Research"',
        '[aria-label*="Deep Research"]',
        'mat-chip:has-text("Deep Research")',
    ],
    "send": [
        'button[aria-label*="Send"]',
        'button[aria-label*="submit"]',
        'button:has-text("Send")',
        '[data-test-id="send-button"]',
        "button.send-button",
    ],
    "response": [
        ".response-content",
        ".model-response",
        '[data-message-author="model"]',
        ".markdown-body",
        "message-content",
    ],
}


def slugify(text: str, max_length: int = 50) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text[:max_length].strip("-")


def ensure_chrome_running() -> bool:
    """Check if Chrome is running with remote debugging, start if not."""
    # Check if already running
    result = subprocess.run(["lsof", "-i", f":{CHROME_DEBUG_PORT}"], capture_output=True, text=True)

    if "Google" in result.stdout:
        print(f"Chrome automation already running on port {CHROME_DEBUG_PORT}")
        return True

    # Start Chrome with remote debugging
    print(f"Starting Chrome with remote debugging on port {CHROME_DEBUG_PORT}...")
    profile_dir = Path.home() / "chrome-automation-profile"

    subprocess.Popen(
        [
            CHROME_PATH,
            f"--remote-debugging-port={CHROME_DEBUG_PORT}",
            f"--user-data-dir={profile_dir}",
            "--no-first-run",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait for Chrome to start
    time.sleep(3)

    # Verify it started
    result = subprocess.run(["lsof", "-i", f":{CHROME_DEBUG_PORT}"], capture_output=True, text=True)

    if "Google" in result.stdout:
        print("Chrome started successfully")
        return True

    print("Failed to start Chrome. Please start manually:")
    print(
        f'  {CHROME_PATH} --remote-debugging-port={CHROME_DEBUG_PORT} --user-data-dir="$HOME/chrome-automation-profile"'
    )
    return False


async def retry_step(label: str, func, attempts: int = STEP_RETRIES):
    """Retry helper with exponential backoff for brittle UI steps."""
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            return await func()
        except Exception as e:
            last_err = e
            if attempt == attempts:
                raise
            delay = STEP_BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"[retry] {label} failed (attempt {attempt}/{attempts}): {e}")
            await asyncio.sleep(delay)
    raise last_err


async def find_first_selector(page, selectors, timeout=3000):
    """Return first matching element from a selector list."""
    last_error = None
    for selector in selectors:
        try:
            element = await page.wait_for_selector(selector, timeout=timeout)
            if element:
                return element
        except PlaywrightTimeout as e:
            last_error = e
            continue
    if last_error:
        raise last_error
    return None


async def _click_optional_deep_research(page) -> bool:
    """Try to enable Deep Research mode; return True if clicked."""
    try:
        element = await find_first_selector(page, SELECTORS["deep_research"], timeout=3000)
        if element:
            await element.click()
            print("Deep Research mode activated")
            await asyncio.sleep(1)
            return True
    except Exception:
        pass

    print("Warning: Could not find Deep Research button. Proceeding with regular chat...")
    print("The research may not be as comprehensive.")
    return False


async def _send_prompt(page, input_element) -> bool:
    """Send the prompt using a button when possible, fallback to Enter."""
    try:
        send_btn = await find_first_selector(page, SELECTORS["send"], timeout=2000)
        if send_btn and await send_btn.is_enabled():
            await send_btn.click()
            return True
    except Exception:
        pass

    await input_element.press("Enter")
    return True


async def run_deep_research(
    topic: str, output_path: Path | None = None, timeout_minutes: int = 20, model: str = "pro"
) -> str | None:
    """
    Run Gemini Deep Research via browser automation.

    Args:
        topic: Research topic/prompt
        output_path: Where to save the result (auto-generated if None)
        timeout_minutes: Max time to wait for completion
        model: 'pro' or 'fast'

    Returns:
        Path to output file, or None if failed
    """

    if not ensure_chrome_running():
        return None

    # Generate output path if not provided
    if output_path is None:
        date_str = datetime.now().strftime("%Y-%m-%d")
        slug = slugify(topic)
        output_path = DEFAULT_OUTPUT_DIR / f"{date_str}-{slug}.md"

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        try:
            # Connect to existing Chrome instance
            browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{CHROME_DEBUG_PORT}")
            print("Connected to Chrome")
        except Exception as e:
            print(f"Failed to connect to Chrome: {e}")
            print("Make sure Chrome is running with remote debugging enabled.")
            return None

        # Get or create a context
        contexts = browser.contexts
        if contexts:
            context = contexts[0]
        else:
            context = await browser.new_context()

        # Create new page
        page = await context.new_page()

        try:
            # Navigate to Gemini
            print("Navigating to Gemini...")
            await page.goto(GEMINI_URL, wait_until="networkidle", timeout=30000)

            # Wait for page to be ready
            await asyncio.sleep(2)

            # Check if logged in (look for input area or login button)
            try:
                # Look for the main input textarea
                await page.wait_for_selector('div[contenteditable="true"], textarea', timeout=10000)
                print("Gemini loaded, user is logged in")
            except PlaywrightTimeout:
                print("Error: Not logged in to Gemini. Please log in manually:")
                print(f"  1. Open Chrome at http://127.0.0.1:{CHROME_DEBUG_PORT}")
                print("  2. Navigate to gemini.google.com")
                print("  3. Sign in with your Google account")
                await page.close()
                return None

            # Click on Deep Research button/mode
            print("Looking for Deep Research option...")
            _deep_research_clicked = await retry_step(
                "deep_research_toggle",
                lambda: _click_optional_deep_research(page),
                attempts=STEP_RETRIES,
            )

            # Find and fill the input area
            print(f"Entering research topic: {topic[:50]}...")
            input_element = await retry_step(
                "find_input",
                lambda: find_first_selector(page, SELECTORS["input"], timeout=3000),
                attempts=STEP_RETRIES,
            )
            if not input_element:
                print("Error: Could not find input field")
                await page.close()
                return None

            # Type the research prompt
            await input_element.click()
            await input_element.fill(topic)
            await asyncio.sleep(0.5)

            # Submit the prompt (press Enter or click send button)
            print("Submitting research request...")
            _sent = await retry_step(
                "send_prompt",
                lambda: _send_prompt(page, input_element),
                attempts=STEP_RETRIES,
            )

            print(f"Research started. Waiting up to {timeout_minutes} minutes for completion...")

            # Poll for completion
            start_time = time.time()
            timeout_seconds = timeout_minutes * 60
            last_content = ""
            stable_count = 0

            while time.time() - start_time < timeout_seconds:
                await asyncio.sleep(POLL_INTERVAL)
                elapsed = int(time.time() - start_time)
                print(f"  [{elapsed}s] Checking progress...")

                # Look for response content
                current_content = ""
                for selector in SELECTORS["response"]:
                    try:
                        elements = await page.query_selector_all(selector)
                        for el in elements:
                            text = await el.inner_text()
                            if text and len(text) > len(current_content):
                                current_content = text
                    except Exception:
                        continue

                # Check if content has stabilized (research complete)
                if current_content and len(current_content) > 500:
                    if current_content == last_content:
                        stable_count += 1
                        if stable_count >= 2:  # Content stable for 2 poll cycles
                            print("Research appears complete!")
                            break
                    else:
                        stable_count = 0
                        print(f"  Content growing: {len(current_content)} chars")

                last_content = current_content

                # Check for explicit completion indicators
                try:
                    # Look for "Research complete" or similar
                    complete_indicators = await page.query_selector_all("text=/complete|finished|done/i")
                    if complete_indicators:
                        print("Completion indicator found!")
                        await asyncio.sleep(5)  # Wait a bit more for final rendering
                        break
                except Exception:
                    pass

            # Extract final content
            print("Extracting research results...")

            # Get the full HTML of the response area
            html_content = ""
            for selector in SELECTORS["response"]:
                try:
                    elements = await page.query_selector_all(selector)
                    for el in elements:
                        html = await el.inner_html()
                        if html and len(html) > len(html_content):
                            html_content = html
                except Exception:
                    continue

            if not html_content:
                # Fallback: get from main content area
                try:
                    main_content = await page.query_selector("main, .main-content, #main")
                    if main_content:
                        html_content = await main_content.inner_html()
                except Exception:
                    pass

            if not html_content:
                print("Error: Could not extract research results")
                await page.close()
                return None

            # Convert HTML to Markdown
            h2t = html2text.HTML2Text()
            h2t.ignore_links = False
            h2t.ignore_images = True
            h2t.body_width = 0  # Don't wrap lines

            markdown_content = h2t.handle(html_content)

            # Clean up the markdown
            markdown_content = re.sub(r"\n{3,}", "\n\n", markdown_content)

            # Add metadata header
            final_content = f"""# Research: {topic}

> Generated by Gemini Deep Research
> Date: {datetime.now().strftime("%Y-%m-%d %H:%M")}

---

{markdown_content}
"""

            # Save to file
            output_path.write_text(final_content, encoding="utf-8")
            print(f"\nResearch saved to: {output_path}")

            await page.close()
            return str(output_path)

        except Exception as e:
            print(f"Error during research: {e}")
            await page.close()
            return None


def main():
    parser = argparse.ArgumentParser(description="Run Gemini Deep Research via browser automation")
    parser.add_argument("topic", help="Research topic or prompt")
    parser.add_argument("-o", "--output", help="Output file path (default: auto-generated in Research folder)")
    parser.add_argument("--timeout", type=int, default=20, help="Max wait time in minutes (default: 20)")
    parser.add_argument(
        "--model", choices=["pro", "fast"], default="pro", help="Model to use: pro (thorough) or fast (quick)"
    )

    args = parser.parse_args()

    output_path = Path(args.output) if args.output else None

    result = asyncio.run(
        run_deep_research(topic=args.topic, output_path=output_path, timeout_minutes=args.timeout, model=args.model)
    )

    if result:
        print(f"\nSuccess! Research saved to:\n{result}")
        sys.exit(0)
    else:
        print("\nResearch failed. See errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
