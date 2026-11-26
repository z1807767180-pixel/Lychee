"""Render source-attributed prepared foods and product labels with explicit weight bases."""

import json
import math
from pathlib import Path


def extra_food_calls():
    entries = []
    for name in ("ajinomoto_msg", "ottawa_caesar", "norway_pizza_crust"):
        record = json.loads(Path(__file__).with_name(name + ".json").read_text(encoding="utf-8"))
        origin, code = record["id"].split("-", 1)
        basis_grams = record.get("basisGrams", record["portionGrams"])
        if not isinstance(basis_grams, (float, int)) or not math.isfinite(basis_grams) or basis_grams <= 0:
            raise ValueError(f"Missing nutrient basis in {name}")
        values = []
        for nutrient in ("kcal", "protein", "carbs", "fat"):
            value = record[nutrient]
            if not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"Invalid {nutrient} in {name}")
            values.append(round(value * 100 / basis_grams, 4))
        fields = [origin, code, record["name"], record["aliases"], *values,
                  record["basis"], record["cookingNote"], record["portionGrams"],
                  record["portionUnit"], record["source"]]
        entries.append("    food(" + json.dumps(fields, ensure_ascii=False)[1:-1] + ")")
    return entries
