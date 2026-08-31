class NetworkError(Exception):
    pass

class ScanError(NetworkError):
    pass

class SpoofError(NetworkError):
    pass

class SessionNotFoundError(SpoofError):
    pass