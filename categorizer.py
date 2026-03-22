"""
categorizer.py — Assigns a spending category to each transaction.

Uses a keyword-matching approach: checks if any keyword from a category appears
anywhere in the transaction description (case-insensitive).

Instead of an "Other" bucket, unmatched transactions are labelled "Pending Review"
and a best-guess suggested_category is returned alongside them so the user can
confirm or correct it in the Sanity Check stage.
"""

import json
import os
import re

import pandas as pd

# ---------------------------------------------------------------------------
# 13 canonical spending categories (in priority order).
# "Pending Review" is NOT in this list — it's a temporary holding state.
# Priority order matters: Financial & Transfers must be first to prevent
# CC payments and account transfers from leaking into spending totals.
# Food Delivery is checked before Dining & Drinks so Uber Eats doesn't
# get swallowed by the "uber " rideshare keyword in Commute & Transport.
# ---------------------------------------------------------------------------
ALL_CATEGORIES = [
    "Financial & Transfers",   # excluded from spend totals
    "Housing & Utilities",
    "Connectivity",
    "Food Delivery",           # before Dining & Drinks and Commute & Transport
    "Commute & Transport",
    "Groceries",
    "Dining & Drinks",
    "Fitness & Active",
    "Health & Medical",
    "Professional Development",
    "Shopping & Retail",
    "Entertainment",
    "Travel & Getaways",
]

# ---------------------------------------------------------------------------
# Keyword dictionary — keys must exactly match ALL_CATEGORIES entries.
# Each list entry is a lowercase substring to look for in the description.
# Add or remove keywords here to tune categorization to your spending habits.
# ---------------------------------------------------------------------------
CATEGORY_KEYWORDS = {
    "Financial & Transfers": [
        # Credit card payments (most important — catch before anything else)
        "payment thank you", "autopay", "online payment", "minimum payment",
        "credit card payment", "cc payment",
        # Account transfers
        "transfer", "zelle", "venmo", "paypal transfer", "wire transfer",
        "ach", "mobile deposit", "atm deposit", "mobile check deposit",
        # Investments & savings
        "wealthfront", "betterment", "vanguard", "fidelity", "schwab",
        "robinhood", "etrade", "brokerage", "investment", "ira ", "401k",
        "high yield", "sofi ", "marcus ", "ally bank", "savings transfer",
        # Taxes & fees
        "tax payment", "irs ", "state revenue", "franchise tax",
        "property tax", "tax prep", "turbotax", "h&r block",
        "bank fee", "service charge",
        # Payroll & income
        "direct deposit", "payroll", "dividend", "interest paid",
        # Refunds / cashback
        "refund", "cashback", "rewards redemption", "cash back",
    ],
    "Housing & Utilities": [
        # Rent & mortgage
        "rent", "apartment", "lease", "hoa ", "mortgage",
        # Insurance (home / renters)
        "renters insurance", "lemonade insurance", "home insurance",
        # Electricity
        "electric ", "ladwp", "pg&e", "con ed", "comed", "duke energy",
        "pse&g", "national grid", "aep ", "dominion energy", "sdge",
        # Gas utility (home heating — NOT gasoline)
        "gas utility", "socal gas", "southern california gas", "nicor gas",
        "atmos energy", "centerpoint energy",
        # Water / sewage
        "water bill", "water utility", "sewage",
    ],
    "Connectivity": [
        # Mobile phone carriers
        "at&t", "verizon", "t-mobile", "sprint ", "mint mobile",
        "cricket wireless", "boost mobile", "google fi",
        # Internet / cable / TV
        "internet ", "comcast", "xfinity", "spectrum ", "cox comm",
        "verizon fios", "centurylink", "starlink", "cable bill",
        # Cloud storage (iCloud & Google One go here, not Entertainment)
        "icloud", "google one",
    ],
    "Food Delivery": [
        # Delivery platforms — checked BEFORE Commute & Transport so
        # "uber eats" doesn't get swallowed by the "uber " rideshare keyword
        "doordash", "uber eats", "ubereats", "grubhub", "seamless",
        "postmates", "instacart", "caviar", "gopuff",
    ],
    "Commute & Transport": [
        # Rideshare — Food Delivery is higher priority so "uber eats" is
        # already caught before we get here; "uber" alone is safe to use.
        "uber", "lyft",
        # Public transit
        "mta ", "transit", "cta ", "bart ", "metro ", "bus fare",
        "tap card", "clipper card", "presto card",
        "e-zpass", "fastrak", "toll ",
        # Gasoline / fuel
        "chevron", "shell ", "bp ", "exxon", "mobil ", "sunoco",
        "citgo", "valero", "speedway", "wawa", "arco ", "76 ",
        "gas station", "marathon oil",
        # Parking
        "parking", "spothero", "parkwhiz",
        # Car payment & auto insurance
        "car payment", "auto loan", "geico", "progressive",
        "allstate auto", "state farm auto", "car insurance", "auto insurance",
        # Short-term city car rental
        "zipcar",
    ],
    "Groceries": [
        "whole foods", "trader joe", "ralphs", "safeway", "kroger",
        "wegmans", "sprouts", "costco", "bj's wholesale", "sam's club",
        "aldi", "publix", "stop & shop", "giant food", "harris teeter",
        "fresh market", "market basket", "food lion", "winn-dixie",
        "h-e-b", "meijer", "albertsons", "smart & final", "vons",
        "pavilions", "stater bros", "winco", "grocery",
    ],
    "Dining & Drinks": [
        # Coffee shops
        "starbucks", "dunkin", "coffee", "cafe", "espresso",
        "boba", "smoothie", "juice bar",
        # Fast-food / quick-service chains
        "mcdonald", "chipotle", "subway", "taco bell", "wendy's",
        "chick-fil-a", "panera", "five guys", "shake shack", "in-n-out",
        "panda express", "popeyes", "raising cane", "wingstop",
        # Sit-down / general restaurant keywords
        "restaurant", "pizza", "sushi", "burger", "diner", "bistro",
        "grill", "kitchen", "eatery", "bakery", "steakhouse",
        "noodle", "ramen", "thai", "taqueria", "trattoria", "brasserie",
        # Bars & nightlife
        "bar ", "brewery", "tavern", "pub ", "nightclub", "lounge",
        "cocktail", "winery", "wine bar",
    ],
    "Fitness & Active": [
        # Gyms & studios
        "equinox", "orangetheory", "planet fitness", "peloton", "crossfit",
        "classpass", "ymca", "la fitness", "24 hour fitness",
        "anytime fitness", "lifetime fitness", "crunch fitness", "barry's",
        # Yoga / pilates / movement
        "yoga", "pilates", "barre", "dance studio",
        # Outdoor & sport-specific
        "ikon pass", "epic pass", "ski ", "snowboard",
        "race registration", "marathon", "triathlon",
        "tennis ", "padel", "golf ", "swim",
        "rei ", "patagonia", "north face",
    ],
    "Health & Medical": [
        # Pharmacies
        "cvs ", "walgreens", "rite aid", "pharmacy",
        # Medical providers
        "doctor", "hospital", "clinic", "dental", "dentist",
        "optometrist", "vision ", "urgent care", "medical ",
        "lab corp", "quest diagnostics",
        # Therapy & mental health
        "therapy", "therapist", "counseling", "psychiatry",
        "betterhelp", "talkspace", "cerebral ",
        # Physical therapy & body care
        "physio", "physical therapy", "chiropractor", "massage",
    ],
    "Professional Development": [
        # Courses & education platforms
        "coursera", "udemy", "skillshare", "masterclass", "duolingo",
        "tuition", "university", "college ", "edx", "linkedin learning",
        "gmat", "gre ", "mba ",
        # Books
        "book", "kindle",
        # Events & certifications
        "conference", "certification", "aws certified",
    ],
    "Shopping & Retail": [
        # Online / big-box
        "amazon", "target", "walmart", "best buy", "apple store",
        "ebay", "etsy",
        # Home goods & furniture
        "wayfair", "ikea", "home depot", "lowe's", "west elm",
        "living spaces", "pottery barn", "crate and barrel",
        "williams sonoma", "restoration hardware",
        # Clothing & fashion
        "nordstrom", "macy's", "gap ", "h&m", "zara", "uniqlo",
        "nike", "adidas", "old navy", "banana republic",
        "tj maxx", "marshalls", "ross stores", "revolve", "ssense",
        # Electronics
        "newegg", "micro center", "b&h photo", "apple.com",
        # Misc retail
        "dollar tree", "five below",
    ],
    "Entertainment": [
        # Video streaming
        "netflix", "hulu", "disney+", "disney plus", "hbo", "max ",
        "paramount+", "peacock", "discovery+", "apple tv+",
        # Music streaming
        "spotify", "apple music", "tidal",
        # Other media
        "youtube premium", "amazon prime", "apple one", "audible",
        # Gaming
        "steam ", "playstation", "xbox", "nintendo", "twitch",
        # Software subscriptions
        "adobe ", "microsoft 365", "microsoft 36", "office 365",
        "zoom ", "slack ", "notion ", "github", "chatgpt", "openai",
        "google workspace", "dropbox",
        # Live events & cinemas
        "ticketmaster", "eventbrite", "stubhub", "live nation",
        "amc ", "regal ", "cinemark", "movie", "cinema",
        "concert", "theater", "theatre", "museum", "zoo",
    ],
    "Travel & Getaways": [
        # Flights
        "airline", "united air", "delta air", "american air",
        "southwest air", "jetblue", "spirit air", "frontier air",
        "alaska air", "google flights",
        # Hotels & lodging
        "hotel", "marriott", "hilton", "hyatt", "holiday inn",
        "airbnb", "vrbo", "booking.com", "expedia", "hotels.com",
        "ihg ", "westin", "sheraton", "four seasons", "ritz carlton",
        # Car rentals for travel (distinct from daily Zipcar commute)
        "hertz", "enterprise rent", "avis", "budget rent", "turo",
        # Intercity transport
        "amtrak", "greyhound",
    ],
}


def suggest_category(description):
    """
    Make a best-guess category for an unmatched transaction based on
    simple word hints in the description.

    This is intentionally simple and broad — it's meant to pre-fill a
    dropdown for the user to confirm, not to be perfectly accurate.

    Parameters
    ----------
    description : str
        The raw transaction description string.

    Returns
    -------
    str
        One of the 13 canonical categories from ALL_CATEGORIES.
    """
    desc_lower = description.lower()

    # Financial signals — check first
    if any(w in desc_lower for w in ["transfer", "payment", "deposit", "fee", "tax", "invest"]):
        return "Financial & Transfers"

    # Food delivery (very specific — before generic food words)
    if any(w in desc_lower for w in ["delivery", "doordash", "grubhub", "ubereats"]):
        return "Food Delivery"

    # Travel (before transport so "hotel" doesn't go to Commute)
    if any(w in desc_lower for w in ["hotel", "flight", "airline", "airbnb", "travel"]):
        return "Travel & Getaways"

    # Grocery signals
    if any(w in desc_lower for w in ["grocery", "grocer", "supermarket", "market"]):
        return "Groceries"

    # Dining / food
    if any(w in desc_lower for w in ["restaurant", "cafe", "bar", "food", "eat", "drink", "coffee", "pizza"]):
        return "Dining & Drinks"

    # Fitness / health
    if any(w in desc_lower for w in ["gym", "fitness", "yoga", "pilates", "sport", "active", "workout"]):
        return "Fitness & Active"
    if any(w in desc_lower for w in ["health", "medical", "clinic", "pharma", "therapy", "doctor"]):
        return "Health & Medical"

    # Housing / utilities
    if any(w in desc_lower for w in ["rent", "utility", "electric", "water", "gas bill"]):
        return "Housing & Utilities"

    # Connectivity
    if any(w in desc_lower for w in ["phone", "internet", "mobile", "wireless", "cloud"]):
        return "Connectivity"

    # Transport
    if any(w in desc_lower for w in ["parking", "transit", "uber", "lyft", "gas station", "fuel"]):
        return "Commute & Transport"

    # Education
    if any(w in desc_lower for w in ["course", "book", "school", "university", "learn", "certif"]):
        return "Professional Development"

    # Entertainment / subscriptions
    if any(w in desc_lower for w in ["stream", "subscription", "monthly", "annual", "app "]):
        return "Entertainment"

    # Default
    return "Shopping & Retail"


def categorize(description):
    """
    Return a (category, suggested_category) tuple for a transaction description.

    - If a keyword match is found: returns (matched_category, None)
    - If no match:                 returns ("Pending Review", suggested_category)

    The suggested_category in the second case is generated by suggest_category()
    and is meant to be shown as a pre-filled guess in the UI.

    Parameters
    ----------
    description : str
        The raw transaction description string.

    Returns
    -------
    tuple of (str, str or None)
    """
    desc_lower = str(description).lower()

    for category in ALL_CATEGORIES:  # Priority order defined at top of file
        keywords = CATEGORY_KEYWORDS[category]
        if any(kw in desc_lower for kw in keywords):
            return (category, None)

    # No keyword matched — return Pending Review with a suggested guess
    suggestion = suggest_category(description)
    return ("Pending Review", suggestion)


def categorize_transactions(df):
    """
    Add 'category' and 'suggested_category' columns to a transactions DataFrame.

    - 'category':           The matched category, or "Pending Review" if no match.
    - 'suggested_category': The AI-guessed category for "Pending Review" rows;
                            None for rows that were matched automatically.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain a 'description' column.

    Returns
    -------
    pd.DataFrame
        Copy of df with two new columns added.
    """
    df = df.copy()

    # Apply categorize() to each row and unpack the tuple into two columns
    results = df["description"].apply(categorize)
    df["category"] = results.apply(lambda t: t[0])
    df["suggested_category"] = results.apply(lambda t: t[1])

    return df


# ---------------------------------------------------------------------------
# LLM-powered categorization (uses Claude API for transactions that keyword
# matching couldn't place). Runs in batches to keep prompt size manageable.
# ---------------------------------------------------------------------------

_LLM_BATCH_SIZE = 50  # descriptions per API call


def llm_categorize_batch(descriptions, api_key=None):
    """
    Send a batch of transaction descriptions to Claude and get back a category
    for each one.

    Parameters
    ----------
    descriptions : list of str
        Transaction descriptions that keyword matching could not categorize.
    api_key : str, optional
        Anthropic API key. Falls back to the ANTHROPIC_API_KEY environment
        variable if not provided.

    Returns
    -------
    tuple of (list of str or None, str or None)
        (categories, None) on success — one category per description.
        (None, error_message) if the API call fails.
    """
    try:
        import anthropic
    except ImportError:
        return None, "anthropic package not installed. Run: pip3 install anthropic"

    resolved_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not resolved_key:
        return None, "No Anthropic API key found. Enter one in ⚙️ Settings."

    client = anthropic.Anthropic(api_key=resolved_key)

    # Build the prompt
    categories_list = "\n".join(f"- {c}" for c in ALL_CATEGORIES)
    numbered_items = "\n".join(f"{i + 1}. {desc}" for i, desc in enumerate(descriptions))

    prompt = f"""You are a personal finance transaction categorizer for a US urban professional.

Categorize each transaction description into exactly one of these categories:
{categories_list}

Transaction descriptions to categorize:
{numbered_items}

Rules:
- Every entry must be one of the exact category names listed above.
- The array must have exactly {len(descriptions)} elements.
- Return ONLY a valid JSON array — no explanation, no extra text.

Example format: ["Food & Social", "Subscriptions", "Commute & Travel"]"""

    try:
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw_text = response.content[0].text.strip()

        # Extract the JSON array even if there's surrounding text
        match = re.search(r"\[.*\]", raw_text, re.DOTALL)
        if match:
            raw_text = match.group(0)

        result = json.loads(raw_text)

        # Validate every returned value; fall back to "Shopping & Retail" if unknown
        validated = []
        for cat in result:
            validated.append(cat if cat in ALL_CATEGORIES else "Shopping & Retail")

        # Guard against the LLM returning the wrong number of items
        if len(validated) != len(descriptions):
            return None, (
                f"LLM returned {len(validated)} categories for {len(descriptions)} "
                "descriptions. Falling back to manual review."
            )

        return validated, None

    except Exception as exc:
        return None, str(exc)


def llm_categorize_batch_gemini(descriptions, api_key):
    """
    Send a batch of transaction descriptions to Google Gemini and get back
    a category for each one.

    Parameters
    ----------
    descriptions : list of str
    api_key : str
        Google AI Studio API key.

    Returns
    -------
    tuple of (list of str or None, str or None)
    """
    try:
        from google import genai
    except ImportError:
        return None, "google-genai not installed. Run: pip3 install google-genai"

    client = genai.Client(api_key=api_key)

    categories_list = "\n".join(f"- {c}" for c in ALL_CATEGORIES)
    numbered_items = "\n".join(f"{i + 1}. {desc}" for i, desc in enumerate(descriptions))

    prompt = f"""You are a personal finance transaction categorizer for a US urban professional.

Categorize each transaction description into exactly one of these categories:
{categories_list}

Transaction descriptions to categorize:
{numbered_items}

Rules:
- Every entry must be one of the exact category names listed above.
- The array must have exactly {len(descriptions)} elements.
- Return ONLY a valid JSON array — no explanation, no extra text.

Example format: ["Dining & Drinks", "Groceries", "Commute & Transport"]"""

    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
        )
        raw_text = response.text.strip()

        match = re.search(r"\[.*\]", raw_text, re.DOTALL)
        if match:
            raw_text = match.group(0)

        result = json.loads(raw_text)

        validated = [cat if cat in ALL_CATEGORIES else "Shopping & Retail" for cat in result]

        if len(validated) != len(descriptions):
            return None, (
                f"Gemini returned {len(validated)} categories for {len(descriptions)} descriptions."
            )

        return validated, None

    except Exception as exc:
        return None, str(exc)


def llm_categorize_all(descriptions, api_key=None, provider="claude"):
    """
    Categorize all descriptions using the LLM, splitting into batches as needed.

    Parameters
    ----------
    descriptions : list of str
    api_key : str, optional
        API key for the chosen provider. For Claude, falls back to
        ANTHROPIC_API_KEY env var if not given.
    provider : str
        "claude" (default) or "gemini".

    Returns
    -------
    tuple of (list of str or None, str or None)
    """
    all_results = []

    for i in range(0, len(descriptions), _LLM_BATCH_SIZE):
        batch = descriptions[i: i + _LLM_BATCH_SIZE]

        if provider == "gemini":
            results, error = llm_categorize_batch_gemini(batch, api_key=api_key)
        else:
            results, error = llm_categorize_batch(batch, api_key=api_key)

        if error:
            return None, error
        all_results.extend(results)

    return all_results, None
