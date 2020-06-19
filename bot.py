import logging
import os
from io import BytesIO
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote_plus as url_quote
import subprocess
import tempfile
from queue import Queue
from threading import Thread

import telegram
from telegram.ext import Dispatcher, MessageHandler, CommandHandler, InlineQueryHandler, Filters, CallbackContext
from dotenv import load_dotenv, find_dotenv
from PIL import Image, ImageDraw, ImageFont
import libhoney
from flask import Flask, render_template, request, make_response
app = Flask(__name__)

load_dotenv(find_dotenv())

libhoney.init(writekey=os.environ.get('HONEYCOMB_KEY'), dataset="crabravebot", debug=True)

font = ImageFont.truetype("assets/fonts/NotoSans-Regular.ttf", 48)

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class Style:
    """Crab rave style"""
    id: str
    name: str
    desc: str
    image: Path
    video: Path


def get_styles():
    templates = Path('assets/templates')
    result = []
    for folder in templates.iterdir():
        s_id = folder.name
        name = s_id
        desc = s_id
        image = list(folder.glob('*.png'))[0]
        video = list(folder.glob('*.mp4'))[0]
        result.append(Style(s_id, name, desc, image, video))
    return result


STYLES = get_styles()


def render_text(text: str, base: Image):
    if base.mode == 'RGB':
        white = (255, 255, 255)
        black = (0, 0, 0)
    elif base.mode == 'RGBA':
        white = (255, 255, 255, 255)
        black = (0, 0, 0, 255)
    else:
        raise ValueError('Base image {}, not RGB/RGBA'.format(base.mode))

    draw = ImageDraw.Draw(base)
    text_width, text_height = draw.multiline_textsize(text, font=font)
    center_x = base.width // 2
    center_y = base.height // 2
    draw.multiline_text((center_x - text_width / 2, center_y - text_height / 2), text, font=font,
                        fill=white, stroke_width=1, stroke_fill=black)


def make_image(text: str, style_id: str):
    outfile = BytesIO()
    style = [s for s in STYLES if s.id == style_id][0]
    with Image.open(style.image) as base:
        render_text(text, base)
        base.save(outfile, 'PNG')
    return outfile.getvalue()


def make_video(text: str, style_id: str):
    ev = libhoney.Event()
    ev.add_field('type', 'bake')
    ev.add_field('text', text)
    ev.add_field('style', style_id)
    ev.send()
    style = [s for s in STYLES if s.id == style_id][0]
    with Image.open(style.image) as image:
        size = image.size
    overlay = Image.new('RGBA', size, (0, 0, 0, 0))
    render_text(text, overlay)
    with tempfile.TemporaryDirectory() as tmp:
        overlay_file = Path(tmp) / 'overlay.png'
        overlay.save(overlay_file)
        result_file = Path(tmp) / 'result.mp4'
        subprocess.run([
            'ffmpeg',
            '-hide_banner',
            '-v', 'warning',
            '-i', str(style.video),
            '-i', str(overlay_file),
            '-filter_complex', 'overlay=x=0:y=0',
            '-c:v', 'libx264', '-preset', 'superfast', '-crf', '27', '-f', 'mp4', '-c:a', 'copy',
            '-y', str(result_file)
        ]).check_returncode()
        return result_file.read_bytes()


def start(update: telegram.Update, context: CallbackContext):
    template = r"""Hi {you}!
To shitpost, type @{me} and type the text you want to overlay over crab rave.
This was originally made by @boringcactus in one afternoon when ze was bored.
This bot isn't super reliable but the source is at https://github.com/boringcactus/crabravebot,
and you can use this bot from the Web at https://crabravebot.herokuapp.com/"""
    you = update.effective_user.first_name
    if you is None or len(you) == 0:
        you = update.effective_user.username
    text = template.format(you=you, me=context.bot.username)
    context.bot.send_message(chat_id=update.effective_chat.id, text=text)


def inline_query(update: telegram.Update, context: CallbackContext):
    query = update.inline_query
    text = query.query

    logger.info('Got query %s', text)

    def make_result(style: Style):
        base = "https://crabravebot.herokuapp.com/render?v=1&style=" + style.id + "&text=" + url_quote(text, safe='')
        return telegram.InlineQueryResultVideo(
            id=style.id,
            video_url=base + '&ext=mp4',
            mime_type="video/mp4",
            thumb_url=base + '&ext=png',
            title=style.name,
        )

    query.answer([make_result(s) for s in STYLES])


def message(update: telegram.Update, context: CallbackContext):
    text = update.effective_message.text

    logger.info('Got query %s', text)

    update.effective_message.reply_video(BytesIO(make_video(text, STYLES[0].id)))


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/render')
def serve_render():
    style = request.args['style']
    ext = request.args['ext']
    text = request.args['text']
    if sum(1 for x in STYLES if x.id == style) == 0:
        raise ValueError('bad style')
    if ext == 'png':
        response = make_image(text, style)
        content_type = 'image/png'
    elif ext == 'mp4':
        response = make_video(text, style)
        content_type = 'video/mp4'
    else:
        raise ValueError('bad extension')
    return response, {'Content-Type': content_type}


TOKEN = os.environ.get('TG_BOT_TOKEN')
WEBHOOK = '/webhook/' + TOKEN


@app.route(WEBHOOK, methods=['POST'])
def webhook():
    update_queue.put(telegram.Update.de_json(request.get_json(), bot))


bot = telegram.Bot(token=TOKEN)
bot.set_webhook('https://crabravebot.herokuapp.com' + WEBHOOK)
update_queue = Queue()
dp = Dispatcher(bot, update_queue, use_context=True)
# Add handlers
dp.add_handler(CommandHandler('start', start))
dp.add_handler(InlineQueryHandler(inline_query))
dp.add_handler(MessageHandler(Filters.all, message))

thread = Thread(target=dp.start, name='dispatcher')
thread.start()
