"""一次性迁移脚本：Watchlist + WatchlistItem -> Inode/Dentry/DataStock。

每个 Watchlist -> 顶层 folder 节点（parent_id=NULL）。
每个 WatchlistItem:
  - 若 category/group_name 有值 -> 在对应 watchlist 下先建同名 folder（若不存在），再把 stock 挂在该 folder 下
  - 否则直接挂在 watchlist folder 下

幂等：若 Inode 表已有数据则跳过（避免重复迁移）。
运行：.venv/bin/python scripts/migrate_watchlist_to_portfolio.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, db
from models import Watchlist, WatchlistItem, Inode, Dentry, DataStock


def pick_item_category(item):
    category = getattr(item, 'category', None)
    if category and category.strip():
        return category.strip()
    group_name = getattr(item, 'group_name', None)
    if group_name and group_name.strip():
        return group_name.strip()
    return None


def migrate():
    with app.app_context():
        existing_inode_count = db.session.query(Inode).count()
        if existing_inode_count > 0:
            print(f'[skip] inode table already has {existing_inode_count} rows; aborting to avoid duplication')
            return

        watchlists = Watchlist.query.order_by(Watchlist.sort.asc(), Watchlist.created_at.asc()).all()
        print(f'[migrate] {len(watchlists)} watchlist(s) to convert')

        total_folders = 0
        total_stocks = 0
        for wl in watchlists:
            # 顶层 folder for this watchlist
            folder_inode = Inode(type=Inode.TYPE_FOLDER)
            db.session.add(folder_inode)
            db.session.flush()
            db.session.add(Dentry(parent_id=None, child_id=folder_inode.id, name=wl.name, sort=wl.sort))
            total_folders += 1

            # Group items by category
            items = WatchlistItem.query.filter_by(watchlist_id=wl.id).order_by(
                WatchlistItem.sort.asc(), WatchlistItem.created_at.asc()
            ).all()

            category_folders = {}  # category_name -> inode_id
            next_sort_by_parent = {folder_inode.id: 0}

            for item in items:
                category = pick_item_category(item)

                if category:
                    parent_inode_id = category_folders.get(category)
                    if parent_inode_id is None:
                        sub_inode = Inode(type=Inode.TYPE_FOLDER)
                        db.session.add(sub_inode)
                        db.session.flush()
                        parent_sort = next_sort_by_parent[folder_inode.id]
                        next_sort_by_parent[folder_inode.id] = parent_sort + 1
                        db.session.add(Dentry(
                            parent_id=folder_inode.id,
                            child_id=sub_inode.id,
                            name=category,
                            sort=parent_sort,
                        ))
                        total_folders += 1
                        category_folders[category] = sub_inode.id
                        next_sort_by_parent[sub_inode.id] = 0
                        parent_inode_id = sub_inode.id
                else:
                    parent_inode_id = folder_inode.id

                # Stock node
                stock_inode = Inode(type=Inode.TYPE_STOCK)
                db.session.add(stock_inode)
                db.session.flush()
                db.session.add(DataStock(inode_id=stock_inode.id, symbol=item.symbol))
                display = (item.display_name or '').strip() or item.symbol
                node_sort = next_sort_by_parent[parent_inode_id]
                next_sort_by_parent[parent_inode_id] = node_sort + 1
                db.session.add(Dentry(
                    parent_id=parent_inode_id,
                    child_id=stock_inode.id,
                    name=display,
                    sort=node_sort,
                ))
                total_stocks += 1

        db.session.commit()
        print(f'[ok] migrated: folders={total_folders} stocks={total_stocks}')


if __name__ == '__main__':
    migrate()
