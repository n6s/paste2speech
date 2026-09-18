"""Narrow, speech-only clock and single-digit ratio expansion; called outside URLs."""
import re
SMALL = ('zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen')
CLOCK = r'(0?[1-9]|1[0-2]):([0-5]\d)(?:[ \t]*([ap])\.?m)?'
LEFT, RIGHT = r'(?<![\w:./])', r'(?![\w:/]|\.\w)'

def words(n):
    return SMALL[n] if n < 20 else ('','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety')[n // 10] + (' ' + SMALL[n % 10] if n % 10 else '')

def say(hour, minute, period, shared_period=False):
    m = int(minute)
    tail = ' ' + ('oh ' + words(m) if m < 10 else words(m)) if m else '' if period or shared_period else " o'clock"
    return words(int(hour)) + tail + (' ' + period.upper() + ' M' if period else '')

def time_speech(text):
    text = re.sub(r'\b(ratio(?: of)?[ \t]+)(\d{1,2}):(\d{1,2})(?![\w:/]|\.\w)', lambda m: m[1] + words(int(m[2])) + ' to ' + words(int(m[3])), text, flags=re.I)
    text = re.sub(r'(?<![\w:./])(\d{1,2}):(\d{1,2})(?=[ \t]+ratio\b)', lambda m: words(int(m[1])) + ' to ' + words(int(m[2])), text, flags=re.I)
    text = re.sub(LEFT + CLOCK + r'[ \t]*[-–—→][ \t]*' + CLOCK + RIGHT,
                  lambda m: say(m[1],m[2],m[3],bool(m[6])) + ' to ' + say(m[4],m[5],m[6]), text, flags=re.I)
    text = re.sub(LEFT + CLOCK + RIGHT, lambda m: say(*m.groups()), text, flags=re.I)
    return re.sub(r'(?<![\w:./])([1-9]):([1-9])(?![\w:/]|\.\w)', lambda m: SMALL[int(m[1])] + ' to ' + SMALL[int(m[2])], text)
