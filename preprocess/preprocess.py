"""Turn one month of Online Retail II order lines into JSON for the warehouse twin.

Usage:  python preprocess.py [--month 2010-11] [--top 100]
Input:  raw/online_retail_II.xlsx  (UCI, CC BY 4.0)
Output: ../web/public/data/{products,orders,stats}.json
"""
import argparse
import json
import re
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw" / "online_retail_II.xlsx"
CACHE = HERE / "raw" / "cache"
OUT = HERE.parent / "web" / "public" / "data"

# Stock codes that are fees, postage, adjustments etc. - not physical products on a shelf
NON_PRODUCT = {
    "POST", "DOT", "M", "m", "BANK CHARGES", "AMAZONFEE", "D", "CRUK", "PADS",
    "C2", "C3", "S", "B", "ADJUST", "ADJUST2", "SP1002",
}
NON_PRODUCT_RE = re.compile(r"^(gift_|TEST|DCGS|BOXCHARGE)", re.I)


def load_sheets() -> pd.DataFrame:
    CACHE.mkdir(parents=True, exist_ok=True)
    frames = []
    for sheet in ("Year 2009-2010", "Year 2010-2011"):
        csv = CACHE / f"{sheet}.csv"
        if not csv.exists():
            print(f"reading sheet '{sheet}' from Excel (slow, cached afterwards)...")
            pd.read_excel(RAW, sheet_name=sheet, dtype={"Invoice": str, "StockCode": str}).to_csv(csv, index=False)
        frames.append(pd.read_csv(csv, dtype={"Invoice": str, "StockCode": str}, parse_dates=["InvoiceDate"]))
    return pd.concat(frames).drop_duplicates()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="2010-11")
    ap.add_argument("--top", type=int, default=100)
    args = ap.parse_args()

    df = load_sheets()
    df = df[df["InvoiceDate"].dt.strftime("%Y-%m") == args.month].copy()
    stats = {"month": args.month, "raw_lines": int(len(df)), "raw_invoices": int(df["Invoice"].nunique())}

    df["StockCode"] = df["StockCode"].str.strip()
    cancelled = df["Invoice"].str.startswith("C")
    stats["cancelled_lines_removed"] = int(cancelled.sum())
    df = df[~cancelled]

    non_prod = df["StockCode"].isin(NON_PRODUCT) | df["StockCode"].str.match(NON_PRODUCT_RE)
    stats["non_product_lines_removed"] = int(non_prod.sum())
    df = df[~non_prod]

    bad = (df["Quantity"] <= 0) | df["Description"].isna() | (df["Price"] <= 0)
    stats["invalid_lines_removed"] = int(bad.sum())
    df = df[~bad]
    stats["clean_lines"] = int(len(df))
    stats["clean_invoices"] = int(df["Invoice"].nunique())
    stats["distinct_products"] = int(df["StockCode"].nunique())

    # One "pick" = one order line (picker visits the slot once per line, whatever the quantity)
    lines = df.groupby(["Invoice", "StockCode"], as_index=False).agg(
        qty=("Quantity", "sum"), date=("InvoiceDate", "min"), desc=("Description", "first"))
    freq = lines.groupby("StockCode").agg(picks=("Invoice", "size"), units=("qty", "sum"),
                                          desc=("desc", "first")).sort_values("picks", ascending=False)
    top = freq.head(args.top)
    stats["top_share_of_picks"] = round(float(top["picks"].sum() / freq["picks"].sum()), 4)

    code_to_idx = {c: i for i, c in enumerate(top.index)}
    products = [{"id": i, "code": c, "name": str(r.desc).strip().title(), "picks": int(r.picks), "units": int(r.units)}
                for i, (c, r) in enumerate(top.iterrows())]

    lines = lines[lines["StockCode"].isin(code_to_idx)]
    orders = []
    for inv, g in lines.sort_values("date").groupby("Invoice", sort=False):
        orders.append({
            "id": inv,
            "t": g["date"].min().strftime("%Y-%m-%d %H:%M"),
            "items": [[code_to_idx[c], int(q)] for c, q in zip(g["StockCode"], g["qty"])],
        })
    orders.sort(key=lambda o: o["t"])
    stats["orders_replayed"] = len(orders)
    stats["lines_replayed"] = int(len(lines))
    stats["avg_lines_per_order"] = round(len(lines) / len(orders), 2)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "products.json").write_text(json.dumps(products, indent=1), encoding="utf-8")
    (OUT / "orders.json").write_text(json.dumps(orders, separators=(",", ":")), encoding="utf-8")
    (OUT / "stats.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    print(json.dumps(stats, indent=1))
    print("top 5:", [p["name"] for p in products[:5]])


if __name__ == "__main__":
    main()
