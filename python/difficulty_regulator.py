"""Difficulty regulator for Arithmetic Challenge.

Runs in the browser (Pyodide, inside a Web Worker). JavaScript builds a candidate
equation from raw numbers and asks this module whether it suits the chosen difficulty.
This module owns: input validation, the difficulty score, per-operation difficulty
bands, consistency with recent questions, commutative repetition and operation streaks.
JavaScript owns: raw-number retrieval, candidate construction, exact-duplicate tracking
and the retry loop. The server re-checks the same score/bands (worker/index.js).
The score formula and BANDS below MUST stay identical to worker/index.js.

Learn practice (optional, never recorded): a candidate may carry "mode": "learn" and a
"focus" skill. Learn mode keeps every rule except the operation-streak and
difficulty-consistency checks, which make no sense inside a single-operation lesson.
Without these fields evaluate() behaves exactly as before, so the real game and the
server's re-check are unaffected.
"""
import json

MIN_OPERAND = 0
MAX_OPERAND = 99
OPERATIONS = ("add", "sub", "mul", "div")
DIFFICULTIES = ("easy", "normal", "hard")
OP_BASE = {"add": 4, "sub": 8, "mul": 16, "div": 20}

# Inclusive (min, max) score band per difficulty and operation.
BANDS = {
    "easy":   {"add": (0, 22),  "sub": (0, 24),  "mul": (0, 25),  "div": (0, 34)},
    "normal": {"add": (23, 36), "sub": (25, 36), "mul": (26, 44), "div": (35, 44)},
    "hard":   {"add": (37, 99), "sub": (37, 99), "mul": (45, 99), "div": (45, 99)},
}

def _has_carry(a, b):
    ones = a % 10 + b % 10
    return ones >= 10 or (a // 10) % 10 + (b // 10) % 10 + (1 if ones >= 10 else 0) >= 10


# Skill focus for Learn practice: name -> (operation, test(a, b, answer)).
FOCUSES = {
    "carry": ("add", lambda a, b, ans: _has_carry(a, b)),
    "borrow": ("sub", lambda a, b, ans: a % 10 < b % 10),
    "tables": ("mul", lambda a, b, ans: 2 <= a <= 12 and 2 <= b <= 12),
    "division_facts": ("div", lambda a, b, ans: 2 <= b <= 12),
}

MAX_SPREAD = 35      # allowed distance from the average score of recent questions
MAX_OP_STREAK = 2    # same operation at most this many times in a row
CONSISTENCY_WINDOW = 3


def _is_int(x):
    return type(x) is int


def solve(a, op, b):
    """Return (answer, error_code). error_code is None when the equation is valid."""
    if op == "add":
        return a + b, None
    if op == "sub":
        if a < b:
            return None, "NEGATIVE_RESULT"
        return a - b, None
    if op == "mul":
        return a * b, None
    if op == "div":
        if b == 0:
            return None, "DIVISION_BY_ZERO"
        if a % b != 0:
            return None, "NOT_WHOLE_DIVISION"
        return a // b, None
    return None, "INVALID_OPERATION"


def _size_tier(n):
    return 0 if n < 10 else 3 if n < 20 else 6 if n < 50 else 9


def _answer_tier(n):
    return 4 * sum(1 for t in (10, 50, 100, 500, 1000, 5000) if n >= t)


def _complexity(a, op, b, ans):
    if op == "add":
        if a == 0 or b == 0:
            return -6
        c = 0
        carry = 1 if a % 10 + b % 10 >= 10 else 0
        if carry:
            c += 5
        if (a // 10) % 10 + (b // 10) % 10 + carry >= 10:
            c += 5
        return c
    if op == "sub":
        if b == 0 or ans == 0:
            return -6
        return 6 if a % 10 < b % 10 else 0
    if op == "mul":
        if a <= 1 or b <= 1:
            return -8
        if a >= 10 and b >= 10:
            return 12
        return 4 if min(a, b) >= 6 else 0
    # div
    if a == 0 or b == 1 or ans == 1:
        return -8
    c = 0
    if b >= 10:
        c += 8
    if ans >= 10:
        c += 4
    return c


def is_trivial(a, op, b, ans):
    """Questions with no real work in them (x + 0, x * 1, x / 1, 0 / x, x - x ...) are never used."""
    if op == "add":
        return a == 0 or b == 0
    if op == "sub":
        return b == 0 or ans == 0
    if op == "mul":
        return a <= 1 or b <= 1
    return a == 0 or b == 1 or ans == 1


def score_candidate(a, op, b, ans):
    magnitude = (len(str(a)) + len(str(b)) - 2) * 6
    total = (OP_BASE[op] + magnitude + _size_tier(max(a, b))
             + _answer_tier(ans) + _complexity(a, op, b, ans))
    return max(0, total)


def _reject(reason, **extra):
    out = {"approved": False, "reason": reason}
    out.update(extra)
    return out


def _same_question(a, op, b, r):
    if r["op"] != op:
        return False
    if (r["a"], r["b"]) == (a, b):
        return True
    return op in ("add", "mul") and (r["b"], r["a"]) == (a, b)


def evaluate(candidate):
    """Validate one candidate. Returns a dict with approved/reason (+ score and answer when approved)."""
    if not isinstance(candidate, dict):
        return _reject("INVALID_INPUT")
    a, op, b = candidate.get("a"), candidate.get("op"), candidate.get("b")
    difficulty = candidate.get("difficulty")
    claimed = candidate.get("answer")
    if not (_is_int(a) and _is_int(b) and _is_int(claimed)):
        return _reject("INVALID_INPUT")
    if op not in OPERATIONS:
        return _reject("INVALID_OPERATION")
    if difficulty not in DIFFICULTIES:
        return _reject("INVALID_DIFFICULTY")
    mode = candidate.get("mode")
    if mode not in (None, "learn"):
        return _reject("INVALID_MODE")
    focus = candidate.get("focus")
    if focus is not None and (not isinstance(focus, str) or focus not in FOCUSES):
        return _reject("INVALID_FOCUS")
    if not (MIN_OPERAND <= a <= MAX_OPERAND and MIN_OPERAND <= b <= MAX_OPERAND):
        return _reject("OPERAND_OUT_OF_RANGE")

    answer, err = solve(a, op, b)
    if err:
        return _reject(err)
    if claimed != answer:
        return _reject("WRONG_ANSWER")

    recent = candidate.get("recent", [])
    if not isinstance(recent, list):
        return _reject("INVALID_CONTEXT")
    clean = []
    for r in recent:
        if not (isinstance(r, dict) and _is_int(r.get("a")) and _is_int(r.get("b"))
                and r.get("op") in OPERATIONS and isinstance(r.get("score"), (int, float))
                and not isinstance(r.get("score"), bool)):
            return _reject("INVALID_CONTEXT")
        clean.append(r)

    if is_trivial(a, op, b, answer):
        return _reject("TRIVIAL_QUESTION")
    if focus is not None:
        focus_op, focus_test = FOCUSES[focus]
        if op != focus_op or not focus_test(a, b, answer):
            return _reject("FOCUS_MISMATCH")

    score = score_candidate(a, op, b, answer)
    lo, hi = BANDS[difficulty][op]
    if score < lo:
        return _reject("BELOW_DIFFICULTY", score=score)
    if score > hi:
        return _reject("EXCEEDS_DIFFICULTY", score=score)

    if any(_same_question(a, op, b, r) for r in clean):
        return _reject("REPEATED_QUESTION", score=score)
    if mode != "learn":
        tail = clean[-MAX_OP_STREAK:]
        if len(tail) == MAX_OP_STREAK and all(r["op"] == op for r in tail):
            return _reject("OPERATION_STREAK", score=score)
        window = clean[-CONSISTENCY_WINDOW:]
        if window:
            mean = sum(r["score"] for r in window) / len(window)
            if abs(score - mean) > MAX_SPREAD:
                return _reject("INCONSISTENT_DIFFICULTY", score=score)

    return {"approved": True, "reason": "OK", "score": score, "answer": answer,
            "difficulty": difficulty}


def evaluate_json(payload):
    """Entry point used from JavaScript: JSON string in, JSON string out. Never raises."""
    try:
        return json.dumps(evaluate(json.loads(payload)))
    except Exception:
        return json.dumps({"approved": False, "reason": "REGULATOR_ERROR"})
