"""Refresh the bundled per-100-g nutrition catalogue.

Run with Python 3.10+: python source/diet/import_foods.py
Use --check to compare the bundled version. --tfda-zip and --usda-zip accept
official archives for offline/pinned imports. Windows uses its built-in
Traditional-to-Simplified converter; macOS/Linux use ICU's uconv command.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import NamedTemporaryFile
from urllib.request import urlopen
from zipfile import ZipFile
from supplemental_foods import extra_food_calls


TFDA_URL = "https://data.fda.gov.tw/data/opendata/export/20/csv"
USDA_URL = "https://fdc.nal.usda.gov/fdc-datasets/SR-Legacy-Archive/sr28abbr.zip"
OUTPUT = Path(__file__).resolve().parents[1] / "client" / "diet-foods-v7.js"
UNITS = {"熱量": "kcal", "粗蛋白": "g", "總碳水化合物": "g", "粗脂肪": "g"}

# Preserve the UI names and extra mainland aliases established in the sample.
# These items appear first so the initial picker offers familiar foods.
FEATURED = {
    "A0550601": ("电锅少水白米饭（加水1.1倍）", ["电锅少水白米饭", "少水白饭", "电锅白饭（米加1.1倍水）"]),
    "R2400201": ("白馒头", ["馒头", "白面馒头"]),
    "K0111101": ("水煮蛋", ["白煮蛋", "煮鸡蛋", "水煮鸡蛋"]),
    "H1150201": ("无糖豆浆", ["原味无糖豆浆"]),
    "R4701201": ("嫩豆腐", ["嫩豆腐块"]),
    "R4700901": ("传统豆腐", ["传统板豆腐"]),
    "R2301101": ("小笼包", ["小笼肉包"]),
    "R0300201": ("糯米饭团（油条肉松）", ["台式饭团", "糯米饭团"]),
    "R2400301": ("芋头馒头", []),
    "R2400601": ("黑糖馒头", []),
}
USDA_ITEMS = {
    "20445": ("熟白米饭（长粒）", ["白米饭", "熟白饭", "白饭", "白飯", "米饭", "熟米饭", "熟长粒米饭", "长粒白米饭（熟）"]),
    "02047": ("食盐", ["盐", "餐桌盐", "食用盐", "精盐"]),
    "14148": ("可乐（普通含糖）", ["可乐", "普通可乐", "含糖可乐"]),
    "14073": ("无糖可乐（Zevia）", ["无糖可乐", "零糖可乐", "Zevia可乐"]),
    "01132": ("炒鸡蛋（熟全蛋）", ["炒蛋", "炒鸡蛋", "美式炒蛋"]),
    "05009": ("烤鸡肉（含皮）", ["烤整鸡带皮", "带皮烤鸡肉"]),
    "05013": ("烤鸡肉（去皮）", ["烤整鸡去皮", "去皮烤鸡肉"]),
    "05060": ("烤鸡胸肉（含皮）", ["带皮烤鸡胸", "烤鸡胸带皮"]),
    "05064": ("烤鸡胸肉（去皮）", ["去皮烤鸡胸"]),
    "09003": ("苹果（带皮）", ["苹果"]),
    "09040": ("香蕉", []), "09200": ("橙子", ["鲜橙"]),
    "11091": ("水煮西兰花", ["无盐熟西兰花"]),
    "11205": ("黄瓜（带皮生食）", ["生黄瓜"]),
    "11367": ("水煮土豆（去皮）", ["煮马铃薯"]),
    "04053": ("橄榄油", []),
    "11136": ("水煮白花椰菜（沥干，无加盐）", ["水煮花椰菜", "熟白花菜", "熟白花椰菜", "水煮菜花"]),
    "11458": ("水煮菠菜（沥干，无加盐）", ["熟菠菜", "焯菠菜", "水煮菠菜"]),
    "11125": ("水煮胡萝卜（沥干，无加盐）", ["熟胡萝卜", "水煮胡萝卜"]),
    "11334": ("水煮青甜椒（沥干，无加盐）", ["熟青椒", "熟青甜椒", "水煮青椒"]),
    "10862": ("煎培根（熟，切片猪培根）", ["煎培根", "煎熟培根", "熟猪培根"]),
    "09050": ("鲜蓝莓", ["蓝莓", "蓝莓果"]),
    "09266": ("鲜菠萝", ["菠萝", "凤梨", "鲜凤梨"]),
    "09181": ("橙肉网纹香瓜（cantaloupe）", ["橙肉甜瓜", "橙肉香瓜", "cantaloupe"]),
    "09184": ("蜜露瓜（honeydew）", ["蜜瓜", "绿肉蜜瓜", "蜜露甜瓜", "honeydew"]),
    "11251": ("罗马生菜（生）", ["罗马生菜", "罗曼生菜"]),
    "11252": ("结球生菜（生）", ["冰山生菜", "球生菜", "美生菜"]),
    "18242": ("原味烤面包丁", ["原味面包丁", "面包丁", "面包干丁"]),
    "18243": ("调味烤面包丁", ["调味面包丁"]),
    "01032": ("帕玛森奶酪（磨碎）", ["帕玛森奶酪碎", "帕尔马干酪碎", "帕马森芝士粉"]),
    "01033": ("帕玛森奶酪（硬质）", ["帕玛森奶酪", "帕尔马干酪", "帕尔马芝士"]),
    "01026": ("马苏里拉奶酪（全脂）", ["马苏里拉", "马苏里拉奶酪", "莫扎里拉"]),
    "01027": ("马苏里拉奶酪（低水分全脂）", ["低水分马苏里拉", "低水分全脂马苏里拉"]),
    "06152": ("披萨酱（罐装即用）", ["披萨酱", "比萨酱", "番茄披萨酱"]),
    "11549": ("烹调用番茄酱（罐装）", ["熟番茄酱汁", "罐装番茄酱汁", "番茄烹调酱"]),
    "21299": ("芝士披萨（美国连锁，普通饼底）", ["美式芝士披萨", "美国连锁普通饼底芝士披萨", "芝士披萨"]),
    "43015": ("凯撒沙拉酱（常规）", ["凯撒酱", "凯萨沙拉酱", "凯撒沙拉酱"]),
    "20037": ("长粒糙米饭（熟）", ["熟糙米饭"]),
    "20410": ("鸡蛋面（熟，无加盐）", ["熟蛋面", "水煮鸡蛋面"]),
    "20134": ("米粉（熟）", ["水煮米粉", "熟米粉"]),
    "20115": ("日式荞麦面（熟）", ["熟荞麦面"]),
    "36601": ("美式中餐馆炸春卷", ["美式中餐春卷"]),
    "36602": ("美式中餐馆炒饭（无肉）", ["美式中餐蔬菜炒饭"]),
    "36603": ("美式中餐馆时蔬牛肉", ["美式中餐蔬菜牛肉"]),
    "36617": ("美式中餐馆柠檬鸡", ["美式柠檬鸡"]),
    "36618": ("美式中餐馆左宗棠鸡", ["美式左公鸡"]),
    "36619": ("美式中餐馆宫保鸡丁", ["宫保鸡丁", "宫爆鸡丁", "美式宫保鸡", "美式中餐宫保鸡丁"]),
    "36620": ("美式中餐馆时蔬虾仁", ["美式中餐蔬菜虾仁"]),
    "36621": ("美式中餐馆糖醋鸡", ["美式甜酸鸡"]),
    "36622": ("美式中餐馆糖醋猪肉", ["美式咕咾肉"]),
    "36625": ("美式中餐馆蔬菜捞面（无肉）", ["美式蔬菜捞面"]),
    "36626": ("美式中餐馆时蔬鸡肉", ["美式中餐蔬菜鸡肉"]),
    "36629": ("美式中餐馆陈皮鸡", ["美式橙香鸡"]),
    "36633": ("美式中餐馆芝麻鸡", ["美式芝麻鸡"]),
}
# Explicitly reviewed products whose finished form is established by the
# sample name and preparation together, not by a guess from a dish-name token.
TFDA_REVIEWED = {
    "K0111101": "cooked", "R2201501": "cooked", "R7300101": "cooked",
    "R7300501": "cooked", "R2301101": "as_eaten", "R2400201": "as_eaten",
    "R2400601": "as_eaten", "R2400301": "as_eaten", "R0300201": "as_eaten",
    "R0700201": "as_eaten", "R2700101": "as_eaten", "R2700401": "as_eaten",
    "R2800301": "as_eaten", "R3000101": "as_eaten",
    "R2200801": "frozen_cooked", "R2200901": "frozen_cooked",
}
MAINLAND_TERMS = {
    "马铃薯": "土豆", "番茄": "西红柿", "凤梨": "菠萝", "酪梨": "牛油果",
    "奇异果": "猕猴桃", "高丽菜": "卷心菜", "花椰菜": "花菜",
    "青花菜": "西兰花", "地瓜": "红薯", "优格": "酸奶", "优酪乳": "酸奶饮品",
    "义大利面": "意大利面",
}


def source_file(local_file, url, suffix):
    if local_file:
        archive = local_file.read_bytes()
    else:
        with urlopen(url, timeout=45) as response:
            archive = response.read()
    with ZipFile(io.BytesIO(archive)) as zip_file:
        matches = [name for name in zip_file.namelist() if name.lower().endswith(suffix)]
        if len(matches) != 1:
            raise ValueError(f"Expected one {suffix} file at {url}, found {matches}")
        return zip_file.read(matches[0])


def numeric(value):
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"Invalid nutrient amount: {value}")
    return int(number) if number.is_integer() else number


def taiwan_foods(raw):
    foods = {}
    sheet = csv.DictReader(io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8-sig"))
    for row in sheet:
        code, name = row["整合編號"].strip(), row["樣品名稱"].strip()
        if not code or not name:
            raise ValueError("Missing official food ID or name")
        food = foods.setdefault(code, {"name": name, "aliases": set(), "values": {}})
        if food["name"] != name:
            raise ValueError(f"Conflicting food names for {code}")
        food["aliases"].update(x.strip() for x in re.split(r"[,，;；、]", row["俗名"]) if x.strip())
        nutrient, value = row["分析項"], row["每100克含量"].strip()
        if nutrient == "熱量":
            food["description"] = row["內容物描述"].strip()
            weight = re.fullmatch(r"([0-9.]+)克", row["每單位重"].strip())
            food["unit_grams"] = numeric(weight[1]) if weight else None
        if nutrient not in UNITS or not value:
            continue
        if row["含量單位"].strip() != UNITS[nutrient]:
            raise ValueError(f"Unexpected unit for {code} {nutrient}")
        value = numeric(value)
        previous = food["values"].setdefault(nutrient, value)
        if previous != value:
            raise ValueError(f"Conflicting amounts for {code} {nutrient}")
    return foods


def simplified(words):
    words = sorted(words)
    if not words:
        return {}
    joined = "\n".join(words)
    if sys.platform == "win32":
        import ctypes
        convert = ctypes.WinDLL("kernel32", use_last_error=True).LCMapStringEx
        flag_simplified_chinese = 0x02000000
        length = convert("zh-CN", flag_simplified_chinese, joined, -1, None, 0, None, None, 0)
        if length == 0:
            raise ctypes.WinError(ctypes.get_last_error())
        out = ctypes.create_unicode_buffer(length)
        if not convert("zh-CN", flag_simplified_chinese, joined, -1, out, length, None, None, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        converted = out.value
    else:
        converted = subprocess.run(
            ["uconv", "-f", "UTF-8", "-t", "UTF-8", "-x", "Traditional-Simplified"],
            input=joined, capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout
    return dict(zip(words, converted.split("\n"), strict=True))


def tfda_basis(code, description):
    if code in TFDA_REVIEWED:
        return TFDA_REVIEWED[code]
    state = description.removeprefix("樣品狀態:").split(";")[0]
    if re.match(r"^熟(?:[,，(]|$)", state):
        return "cooked"
    if re.match(r"^生(?:[,，(]|$)", state):
        return "raw_edible"
    if state.startswith(("乾貨", "乾麵條")):
        return "dry"
    if state.startswith("濕麵條"):
        return "wet_noodles"
    if state.startswith("冷凍包裝"):
        return "frozen_packaged"
    if state.startswith("未炸半成品"):
        return "uncooked_product"
    return ""


def taiwan_rows(foods):
    eligible = {key: food for key, food in foods.items() if UNITS.keys() <= food["values"].keys()}
    words = {word for food in eligible.values()
             for word in [food["name"], food["description"], *food["aliases"]]}
    names = simplified(words)
    rows = []
    for key in dict.fromkeys([*FEATURED, *sorted(eligible)]):
        if key not in eligible:
            continue
        food = eligible[key]
        title, extra = FEATURED.get(key, (names[food["name"]], []))
        aliases = {food["name"], names[food["name"]], *extra, *food["aliases"]}
        aliases.update(names[word] for word in food["aliases"])
        if key == "A0550601":
            # Keep the unusually low rice-to-water preparation distinguishable.
            aliases.difference_update({"米饭", "米飯", "白饭", "白飯", "白米饭", "白米飯"})
        for term, alias in MAINLAND_TERMS.items():
            if term in title:
                aliases.add(title.replace(term, alias))
        basis = tfda_basis(key, food["description"])
        grams = food.get("unit_grams") or None
        # TFDA often records "0.0克" for an unknown unit. This is not zero intake.
        unit = "官方记录单位" if grams else ""
        rows.append([key, title, sorted(aliases - {title}), *[food["values"][n] for n in UNITS],
                     basis, names[food["description"]], grams, unit])
    return rows


def usda_rows(raw):
    rows = {}
    for row in csv.reader(io.TextIOWrapper(io.BytesIO(raw), encoding="latin-1"),
                          delimiter="^", quotechar="~"):
        if row[0] in USDA_ITEMS:
            name, aliases = USDA_ITEMS[row[0]]
            code, description = row[:2]
            if description.startswith("RESTAURANT,CHINESE,"):
                note = f"美国中餐馆整道熟食样本：{description.removeprefix('RESTAURANT,CHINESE,')}。"
                basis = "cooked"
            elif code in {"02047", "04053", "14073", "14148", "18242", "18243",
                          "01032", "01033", "01026", "01027", "06152", "11549", "43015"}:
                note, basis = description, "as_eaten"
            elif code == "21299":
                note, basis = "美国披萨连锁店，14 英寸普通饼底，含芝士浇头整片成品。", "cooked"
            elif "RAW" in description.split(","):
                note, basis = description, "raw_edible"
            else:
                if not re.search(r"\b(CKD|RSTD)\b", description):
                    raise ValueError(f"Review preparation state before including {code}")
                note, basis = description, "cooked"
                if code == "01132":
                    note += "；全蛋炒熟成品，原条目未注明额外用油量。"
            # Preserve the official portion definition (cup, individual or
            # restaurant order). It is distinct from a person's actual intake.
            grams = numeric(row[-5]) if row[-5] else None
            unit = row[-4] if grams else ""
            # ABBREV columns: energy, protein, carbohydrate, total fat.
            rows[code] = [code, name, aliases, *[numeric(row[i]) for i in (3, 4, 7, 5)],
                          basis, note, grams, unit]
    return [rows[key] for key in USDA_ITEMS]


def singapore_rows(data):
    rows = []
    for sample in data["samples"]:
        code = sample["id"].removeprefix("sg-")
        portion = numeric(sample["portionGrams"])
        if not portion:
            raise ValueError(f"Expected a positive sample portion for {code}")
        kcal = round(numeric(sample["kJ"]) / 4.184, 2)
        rows.append([code, sample["name"], sample["aliases"], kcal,
                     *[numeric(sample[key]) for key in ("protein", "carbs", "fat")],
                     "cooked", "新加坡食阁购入的完整熟食，按成品可食重量", portion, "研究记录的一份成品"])
    if len({row[0] for row in rows}) != len(rows):
        raise ValueError("Duplicate Singapore study sample ID")
    return rows


def render(tfda, usda, singapore, study, supplement, tfda_digest, usda_digest):
    header = f"""/* Generated by source/diet/import_foods.py. Values per 100 g of edible food.
 * 衛生福利部食品藥物管理署，《食品營養成分資料集》，政府資料開放授權條款第1版。
 * https://data.gov.tw/dataset/8543 · https://data.gov.tw/license
 * Source CSV SHA-256: {tfda_digest}
 * USDA Agricultural Research Service, Standard Reference 28 (May 2016), CC0.
 * https://fdc.nal.usda.gov/fdc-datasets/SR-Legacy-Archive/sr28abbr.zip
 * Source ABBREV.txt SHA-256: {usda_digest}
 * Singapore study: {study["source"]} · {study["license"]}
 * IDs retain the TFDA sample number, USDA NDB number, or study row key.
 * measuredPortionGrams is a source reference unit; grams starts editable at 100.
 */
(() => {{
  'use strict';
  const studySource = {json.dumps(study["source"], ensure_ascii=False)};
  function food(origin, code, name, aliases, kcal, protein, carbs, fat, basis, cookingNote,
                measuredPortionGrams, measuredPortionUnit, sourceOverride) {{
    const source = sourceOverride || (origin === 'tfda' ? '台湾食药署 · ' + code
      : origin === 'usda' ? 'USDA SR28 · NDB ' + code : studySource);
    return {{
      id: origin + '-' + code, name, aliases, grams: 100, kcal, protein, carbs, fat,
      source, basis, cookingNote, measuredPortionGrams, measuredPortionUnit
    }};
  }}
  window.LycheeDietFoodsV7 = [
"""
    lines = []
    for origin, group in [("tfda", tfda), ("usda", usda), ("sg", singapore)]:
        for fields in group:
            args = json.dumps([origin, *fields], ensure_ascii=False)[1:-1]
            lines.append(f"    food({args})")
    lines.extend(supplement)
    return header + ",\n".join(lines) + "\n  ];\n})();\n"


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--tfda-zip", type=Path)
    cli.add_argument("--usda-zip", type=Path)
    cli.add_argument("--check", action="store_true")
    args = cli.parse_args()
    tfda = source_file(args.tfda_zip, TFDA_URL, ".csv")
    usda = source_file(args.usda_zip, USDA_URL, "abbrev.txt")
    foods = taiwan_foods(tfda)
    selected = taiwan_rows(foods)
    if not selected:
        raise ValueError("No complete TFDA foods found")
    extra = usda_rows(usda)
    study = json.loads(Path(__file__).with_name("prepared_samples.json").read_text(encoding="utf-8"))
    singapore = singapore_rows(study)
    supplement = extra_food_calls()
    result = render(selected, extra, singapore, study, supplement, hashlib.sha256(tfda).hexdigest(),
                    hashlib.sha256(usda).hexdigest())
    print(f"TFDA {len(selected)}/{len(foods)} complete, USDA {len(extra)}, "
          f"Singapore {len(singapore)}, supplementary {len(supplement)}; "
          f"total {len(selected)+len(extra)+len(singapore)+len(supplement)}")
    if args.check:
        if OUTPUT.read_text(encoding="utf-8") != result:
            raise SystemExit("Bundled catalogue differs")
    else:
        with NamedTemporaryFile(dir=OUTPUT.parent, delete=False) as output:
            output.write(result.encode("utf-8"))
        os.replace(output.name, OUTPUT)


if __name__ == "__main__":
    main()
