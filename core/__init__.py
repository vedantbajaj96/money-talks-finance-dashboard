from slowapi import Limiter
from slowapi.util import get_remote_address

# Shared rate limiter — imported by server.py (attached to app) and routes
limiter = Limiter(key_func=get_remote_address)
