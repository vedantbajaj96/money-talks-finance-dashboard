"""
categorizer/constants.py — Category lists and keyword dictionaries.

Edit CATEGORY_KEYWORDS or INCOME_KEYWORDS to tune categorization to your
spending habits. No logic lives here — just data.
"""

# ---------------------------------------------------------------------------
# Expense categories (priority order matters — first match wins).
#
# - "Financial & Transfers" must be first: catches CC payments and transfers
#   before any spending category can claim them.
# - "Food Delivery" must come before "Dining & Drinks" and "Commute & Transport"
#   so "Uber Eats" isn't swallowed by the generic "uber" rideshare keyword.
# ---------------------------------------------------------------------------
ALL_CATEGORIES = [
    "Financial & Transfers",    # excluded from spend totals
    "Housing & Utilities",
    "Connectivity",
    "Food Delivery",            # before Dining & Drinks and Commute & Transport
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
# Income categories — only assigned to transactions where expense_amount < 0.
# ---------------------------------------------------------------------------
INCOME_CATEGORIES = [
    "Paycheck & Salary",
    "Freelance & Side Income",
    "Investment & Dividend Income",
    "Reimbursements",
    "Other Income",
]

# ---------------------------------------------------------------------------
# Expense keyword dictionary.
# Each value is a list of lowercase substrings to match against the description.
# Keys must exactly match ALL_CATEGORIES entries.
# ---------------------------------------------------------------------------
CATEGORY_KEYWORDS = {
    "Financial & Transfers": [
        # Credit card payments
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
        # Payroll & income (expense side — e.g. outgoing payroll for a business)
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
        # Cloud storage (iCloud & Google One belong here, not Entertainment)
        "icloud", "google one",
    ],
    "Food Delivery": [
        # Checked BEFORE Commute & Transport so "uber eats" isn't claimed by "uber"
        "doordash", "uber eats", "ubereats", "grubhub", "seamless",
        "postmates", "instacart", "caviar", "gopuff",
    ],
    "Commute & Transport": [
        # Rideshare — "uber eats" already caught above; "uber" alone is safe here
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
        # Coffee
        "starbucks", "dunkin", "coffee", "cafe", "espresso",
        "boba", "smoothie", "juice bar",
        # Fast food
        "mcdonald", "chipotle", "subway", "taco bell", "wendy's",
        "chick-fil-a", "panera", "five guys", "shake shack", "in-n-out",
        "panda express", "popeyes", "raising cane", "wingstop",
        # Restaurants
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
        # Yoga / pilates
        "yoga", "pilates", "barre", "dance studio",
        # Outdoor & sport
        "ikon pass", "epic pass", "ski ", "snowboard",
        "race registration", "marathon", "triathlon",
        "tennis ", "padel", "golf ", "swim",
        "rei ", "patagonia", "north face",
    ],
    "Health & Medical": [
        # Pharmacies
        "cvs ", "walgreens", "rite aid", "pharmacy",
        # Providers
        "doctor", "hospital", "clinic", "dental", "dentist",
        "optometrist", "vision ", "urgent care", "medical ",
        "lab corp", "quest diagnostics",
        # Mental health
        "therapy", "therapist", "counseling", "psychiatry",
        "betterhelp", "talkspace", "cerebral ",
        # Body care
        "physio", "physical therapy", "chiropractor", "massage",
    ],
    "Professional Development": [
        # Courses & platforms
        "coursera", "udemy", "skillshare", "masterclass", "duolingo",
        "tuition", "university", "college ", "edx", "linkedin learning",
        "gmat", "gre ", "mba ",
        # Books
        "book", "kindle",
        # Events & certs
        "conference", "certification", "aws certified",
    ],
    "Shopping & Retail": [
        # Online / big-box
        "amazon", "target", "walmart", "best buy", "apple store",
        "ebay", "etsy",
        # Home goods
        "wayfair", "ikea", "home depot", "lowe's", "west elm",
        "living spaces", "pottery barn", "crate and barrel",
        "williams sonoma", "restoration hardware",
        # Clothing
        "nordstrom", "macy's", "gap ", "h&m", "zara", "uniqlo",
        "nike", "adidas", "old navy", "banana republic",
        "tj maxx", "marshalls", "ross stores", "revolve", "ssense",
        # Electronics
        "newegg", "micro center", "b&h photo", "apple.com",
        # Misc
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
        # Car rentals (travel — distinct from daily Zipcar commute)
        "hertz", "enterprise rent", "avis", "budget rent", "turo",
        # Intercity transport
        "amtrak", "greyhound",
    ],
}

# ---------------------------------------------------------------------------
# Income keyword dictionary.
# Keys must exactly match INCOME_CATEGORIES entries (plus "Financial & Transfers"
# so pure transfers on the income side are still filtered out).
# ---------------------------------------------------------------------------
INCOME_KEYWORDS = {
    "Financial & Transfers": [
        # Pure account-to-account movements — filter these out
        "transfer", "ach transfer", "wire transfer", "savings transfer",
        "account transfer", "mobile deposit", "atm deposit",
    ],
    "Paycheck & Salary": [
        "payroll", "direct deposit", "salary", "wages",
        "adp ", "paychex", "gusto ", "bamboohr", "workday",
    ],
    "Freelance & Side Income": [
        "stripe ", "square ", "venmo", "paypal", "cash app", "zelle",
        "freelance", "consulting", "invoice",
    ],
    "Investment & Dividend Income": [
        "dividend", "interest paid", "interest credit", "capital gain",
        "distribution", "wealthfront", "betterment", "vanguard",
        "fidelity", "schwab", "robinhood", "etrade", "brokerage",
    ],
    "Reimbursements": [
        "refund", "cashback", "cash back", "rewards redemption",
        "reimbursement", "credit adjustment", "dispute credit",
    ],
    "Other Income": [],  # catch-all — matched last
}
