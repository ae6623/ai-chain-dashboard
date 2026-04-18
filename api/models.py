from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone
from sqlalchemy import Index, UniqueConstraint


db = SQLAlchemy()


def to_iso8601(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


class Watchlist(db.Model):
    __tablename__ = 'watchlist'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    name = db.Column(db.String(32), nullable=False)
    sort = db.Column(db.Integer, nullable=False, default=0)
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    item_count = db.Column(db.Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint('name', name='uq_watchlist_name'),
        Index('idx_watchlist_sort', 'sort'),
        Index('idx_watchlist_default', 'is_default'),
    )

    @classmethod
    def get_default(cls):
        return cls.query.filter_by(is_default=True).order_by(cls.sort.asc(), cls.created_at.asc()).first()

    @classmethod
    def get_next_sort(cls):
        max_sort = db.session.query(db.func.max(cls.sort)).scalar()
        return 0 if max_sort is None else max_sort + 1

    @classmethod
    def get_default_replacement(cls, excluded_id):
        return cls.query.filter(cls.id != excluded_id).order_by(cls.sort.asc(), cls.created_at.asc()).first()

    def to_api_dict(self, include_item_count=True):
        payload = {
            'id': self.id,
            'name': self.name,
            'sort': self.sort,
            'isDefault': self.is_default,
            'createdAt': to_iso8601(self.created_at),
            'updatedAt': to_iso8601(self.updated_at),
        }
        if include_item_count:
            payload['itemCount'] = self.item_count
        return payload


class WatchlistItem(db.Model):
    __tablename__ = 'watchlist_item'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    watchlist_id = db.Column(db.Integer, db.ForeignKey('watchlist.id', ondelete='CASCADE'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    symbol = db.Column(db.String(32), nullable=False)
    display_name = db.Column(db.String(128), nullable=True)
    category = db.Column(db.String(64), nullable=True)
    sort = db.Column(db.Integer, nullable=False, default=0)

    watchlist = db.relationship('Watchlist', backref=db.backref('items', lazy='dynamic', cascade='all, delete-orphan'))

    __table_args__ = (
        UniqueConstraint('watchlist_id', 'symbol', name='uq_watchlist_item_symbol'),
        Index('idx_watchlist_item_watchlist_sort', 'watchlist_id', 'sort'),
        Index('idx_watchlist_item_symbol', 'symbol'),
        Index('idx_watchlist_item_category', 'watchlist_id', 'category'),
    )

    @classmethod
    def get_next_sort(cls, watchlist_id):
        max_sort = db.session.query(db.func.max(cls.sort)).filter_by(watchlist_id=watchlist_id).scalar()
        return 0 if max_sort is None else max_sort + 1

    @classmethod
    def count_for_watchlist(cls, watchlist_id):
        return cls.query.filter_by(watchlist_id=watchlist_id).count()

    def to_api_dict(self, symbol_obj=None):
        resolved_symbol = symbol_obj or Symbol.query.filter_by(symbol=self.symbol).first()
        display_name = self.display_name or getattr(resolved_symbol, 'description', None) or self.symbol
        return {
            'id': self.id,
            'watchlistId': self.watchlist_id,
            'symbol': self.symbol,
            'displayName': self.display_name,
            'name': display_name,
            'ticker': getattr(resolved_symbol, 'ticker', self.symbol),
            'fullName': getattr(resolved_symbol, 'full_name', self.symbol),
            'description': getattr(resolved_symbol, 'description', display_name),
            'exchange': getattr(resolved_symbol, 'exchange', ''),
            'type': getattr(resolved_symbol, 'type', ''),
            'category': self.category,
            'sort': self.sort,
            'createdAt': to_iso8601(self.created_at),
            'updatedAt': to_iso8601(self.updated_at),
        }


class Inode(db.Model):
    __tablename__ = 'inode'

    TYPE_FOLDER = 'folder'
    TYPE_STOCK = 'stock'
    TYPE_MARKDOWN = 'markdown'
    ALLOWED_TYPES = (TYPE_FOLDER, TYPE_STOCK, TYPE_MARKDOWN)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    type = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    stock_data = db.relationship(
        'DataStock', uselist=False, backref='inode',
        cascade='all, delete-orphan', passive_deletes=True,
    )
    markdown_data = db.relationship(
        'DataMarkdown', uselist=False, backref='inode',
        cascade='all, delete-orphan', passive_deletes=True,
    )

    __table_args__ = (
        db.CheckConstraint("type IN ('folder', 'stock', 'markdown')", name='ck_inode_type'),
        Index('idx_inode_type', 'type'),
    )


class Dentry(db.Model):
    __tablename__ = 'dentry'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    parent_id = db.Column(
        db.Integer, db.ForeignKey('inode.id', ondelete='CASCADE'), nullable=True
    )
    child_id = db.Column(
        db.Integer, db.ForeignKey('inode.id', ondelete='CASCADE'), nullable=False
    )
    name = db.Column(db.String(255), nullable=False)
    sort = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    parent = db.relationship('Inode', foreign_keys=[parent_id])
    child = db.relationship('Inode', foreign_keys=[child_id])

    __table_args__ = (
        UniqueConstraint('parent_id', 'child_id', name='uq_dentry_parent_child'),
        Index('idx_dentry_parent_sort', 'parent_id', 'sort'),
        Index('idx_dentry_child', 'child_id'),
    )

    @classmethod
    def get_next_sort(cls, parent_id):
        max_sort = db.session.query(db.func.max(cls.sort)).filter(cls.parent_id == parent_id).scalar()
        return 0 if max_sort is None else max_sort + 1


class DataStock(db.Model):
    __tablename__ = 'data_stock'

    inode_id = db.Column(
        db.Integer, db.ForeignKey('inode.id', ondelete='CASCADE'), primary_key=True
    )
    symbol = db.Column(db.String(32), nullable=False)

    __table_args__ = (
        Index('idx_data_stock_symbol', 'symbol'),
    )


class DataMarkdown(db.Model):
    __tablename__ = 'data_markdown'

    inode_id = db.Column(
        db.Integer, db.ForeignKey('inode.id', ondelete='CASCADE'), primary_key=True
    )
    content = db.Column(db.Text, nullable=True)


class Symbol(db.Model):
    __tablename__ = 'symbol'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    symbol = db.Column(db.String(32), nullable=False, unique=True)
    ticker = db.Column(db.String(32), nullable=False)
    full_name = db.Column(db.String(64), nullable=False)
    description = db.Column(db.String(128), nullable=True)
    exchange = db.Column(db.String(32), nullable=False)
    type = db.Column(db.String(16), nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)
    static_info = db.Column(db.JSON, nullable=True)

    __table_args__ = (
        UniqueConstraint('symbol', name='uq_symbol_symbol'),
        Index('idx_symbol_exchange_type', 'exchange', 'type'),
        Index('idx_symbol_type', 'type'),
        Index('idx_symbol_exchange', 'exchange'),
    )

    @classmethod
    def get_by_symbol(cls, symbol):
        return cls.query.filter_by(symbol=symbol).first()

    @classmethod
    def search_symbols(cls, query=None, symbol_type=None, exchange=None, is_visible=None, limit=50):
        query_obj = cls.query
        if query:
            search_pattern = f'%{query}%'
            query_obj = query_obj.filter(
                db.or_(
                    cls.symbol.ilike(search_pattern),
                    cls.ticker.ilike(search_pattern),
                    cls.full_name.ilike(search_pattern),
                    cls.description.ilike(search_pattern)
                )
            )
        if symbol_type:
            query_obj = query_obj.filter_by(type=symbol_type)
        if exchange:
            query_obj = query_obj.filter_by(exchange=exchange)
        if is_visible is not None:
            query_obj = query_obj.filter_by(is_visible=is_visible)
        return query_obj.order_by(cls.id.desc()).limit(limit).all()

    def _market_timezone(self):
        from const import SymbolType

        if self.type == SymbolType.STOCKS_US.value:
            return 'America/New_York'
        if self.type == SymbolType.STOCKS_HK.value:
            return 'Asia/Hong_Kong'
        if self.type == SymbolType.STOCKS_CN.value:
            return 'Asia/Shanghai'
        return 'Etc/UTC'

    def _market_session(self):
        from const import SymbolType

        if self.type == SymbolType.STOCKS_US.value:
            return '0930-1600'
        if self.type == SymbolType.STOCKS_HK.value:
            return '0930-1200,1300-1600'
        if self.type == SymbolType.STOCKS_CN.value:
            return '0930-1130,1300-1500'
        return '24x7'

    def to_dict_extended(self):
        """返回 TradingView UDF 标准格式"""
        from const import SymbolType, Provider

        ret = {
            'name': self.symbol,
            'exchange-traded': self.exchange,
            'exchange-listed': self.exchange,
            'timezone': self._market_timezone(),
            'minmov': 1,
            'minmov2': 0,
            'pointvalue': 1,
            'symbol': self.symbol,
            'full_name': self.full_name,
            'description': self.description or f"{self.symbol} ({self.exchange})",
            'exchange': self.exchange,
            'ticker': self.ticker,
            'type': self.type,
            'currency_code': '',
            'session': self._market_session(),
            'pricescale': 100000 if self.type == 'crypto' else 100,
            'has_intraday': True,
            'has_daily': True,
            'has_weekly_and_monthly': True,
            'visible_plots_set': 'ohlcv',
            'logo_urls': [],
            'exchange_logo': ''
        }
        if self.type == 'crypto':
            ret['currency_code'] = 'USDT'
        elif self.symbol.endswith('.US') or self.symbol.endswith('USD'):
            ret['currency_code'] = 'USD'
        elif self.symbol.endswith('.SH') or self.symbol.endswith('.SZ') or self.symbol.endswith('CNY'):
            ret['currency_code'] = 'CNY'
        elif self.symbol.endswith('.HK') or self.symbol.endswith('HKD'):
            ret['currency_code'] = 'HKD'
        elif self.type == 'fx':
            ret['currency_code'] = self.symbol[3:]
        if self.exchange == Provider.FMP.value:
            ret['supported_resolutions'] = ['1', '5', '60', '1D']
        elif self.exchange == Provider.POLYGON.value:
            ret['supported_resolutions'] = ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M', '12M']
            WS_SYMBOLE_MAP = {
                'GL:XAUUSD': 'CAS.XAU/USD',
                'C:XAUUSD': 'CAS.XAU/USD',
            }
            if self.symbol in WS_SYMBOLE_MAP:
                ret['symbol_ws'] = WS_SYMBOLE_MAP[self.symbol]
        return ret

    def __repr__(self):
        return f'<Symbol {self.symbol} ({self.exchange})>'
