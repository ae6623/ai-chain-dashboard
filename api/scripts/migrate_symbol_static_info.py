"""迁移脚本：为 symbol 表添加 static_info (JSON) 列。

幂等：若列已存在则跳过。
运行：.venv/bin/python scripts/migrate_symbol_static_info.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, db
from sqlalchemy import inspect


def migrate():
    with app.app_context():
        inspector = inspect(db.engine)
        if not inspector.has_table('symbol'):
            print('[skip] symbol table does not exist')
            return

        columns = {col['name'] for col in inspector.get_columns('symbol')}
        if 'static_info' in columns:
            print('[skip] static_info column already exists')
            return

        print('[migrate] adding static_info column to symbol table')
        with db.engine.begin() as connection:
            connection.exec_driver_sql('ALTER TABLE symbol ADD COLUMN static_info JSON')
        print('[ok] done')


if __name__ == '__main__':
    migrate()
