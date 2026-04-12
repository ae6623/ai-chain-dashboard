import enum


def _enum_contains_(cls, item):
    if isinstance(item, cls):
        return True
    return item in cls._value2member_map_

enum.EnumMeta.__contains__ = _enum_contains_


class ValueEnum(enum.Enum):
    def __new__(cls, value, desc):
        obj = object.__new__(cls)
        obj._value_ = value
        obj.desc = desc
        return obj

    @classmethod
    def keys(cls):
        return [item.value for item in cls]

    @classmethod
    def values(cls):
        return [item.value for item in cls]

    @classmethod
    def get_desc(cls, value):
        return cls(value).desc


class SymbolType(ValueEnum):
    CRYPTO = ("crypto", "数字货币")
    METALS = ("metals", "贵金属")
    FX = ("fx", "外汇")
    CFD = ("cfd", "CFD指数")
    ENERGY = ("energy", "能源")
    INDEX = ("index", "指数")
    STOCKS_US = ("stocks-us", "美股")
    STOCKS_HK = ("stocks-hk", "港股")
    STOCKS_CN = ("stocks-cn", "A股")
    CS = ("cs", "CS2饰品")
    COMMODITY = ("commodity", "商品")


class Provider(ValueEnum):
    ALLTICK = ("ALLTICK", "AllTick")
    LONGBRIDGE = ("LONGBRIDGE", "LongBridge")
    BINANCE = ("BINANCE", "Binance")
    POLYGON = ("POLYGON", "Polygon")
    FMP = ("FMP", "FMP")
    FINNHUB = ("FINNHUB", "Finnhub")
