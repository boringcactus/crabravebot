var Libhoney = require("libhoney");
var hny = new Libhoney({
    writeKey: process.env.HONEYCOMB_KEY,
    dataset: "crabravebot"
})
const { Composer } = require('micro-bot');
const child_process = require('child_process');
const fs = require('fs');
const url = require('url');
const { JSDOM } = require("jsdom");

// the bot
const bot = new Composer();

// start command
bot.command('/start', async ({ from, replyWithMarkdown, botInfo }) =>
  replyWithMarkdown(`Hi *${from.first_name || from.username}*!
To shitpost, type @${botInfo.username} and type the text you want to overlay over crab rave.
This was made by @boringcactus in one afternoon when she was bored.
This bot isn't super reliable but the source is at https://glitch.com/edit/#!/${process.env.PROJECT_DOMAIN}`));

// styles
const STYLES = {
  'classic': {
    'video': 'https://cdn.glitch.com/70ea37b5-d264-46e5-a1db-29c786c86515%2FCrabRaveQuieter.mp4?v=1548223581701',
    'thumb': 'https://cdn.glitch.com/70ea37b5-d264-46e5-a1db-29c786c86515%2FCrabRaveBackground.png?v=1566350372048',
  },
  'otamatone': {
    'video': 'https://cdn.glitch.com/70ea37b5-d264-46e5-a1db-29c786c86515%2FCrabRaveOtamatone.mp4?v=1566354239409',
    'thumb': 'https://cdn.glitch.com/70ea37b5-d264-46e5-a1db-29c786c86515%2FCrabRaveOtamatoneBackground.png?v=1566354702285',
  },
}

// inline query
bot.on('inline_query', async ({ inlineQuery, answerInlineQuery }) => {
  const query = inlineQuery.query || '';
  console.log('Got query', query);
  if (query.length > 1) {
    const result = [
      {
        type: "video",
        id: "classic",
        video_url: "https://" + process.env.PROJECT_DOMAIN + ".glitch.me/video/" + encodeURIComponent(query) + ".mp4?v1",
        mime_type: "video/mp4",
        thumb_url: "https://" + process.env.PROJECT_DOMAIN + ".glitch.me/video/" + encodeURIComponent(query) + ".png?v1",
        title: 'Classic'
      },
      {
        type: "video",
        id: "otamatone",
        video_url: "https://" + process.env.PROJECT_DOMAIN + ".glitch.me/video/" + encodeURIComponent(query) + ".mp4?v1&style=otamatone",
        mime_type: "video/mp4",
        thumb_url: "https://" + process.env.PROJECT_DOMAIN + ".glitch.me/video/" + encodeURIComponent(query) + ".png?v1&style=otamatone",
        title: 'Otamatone (original by TheRealSullyG)'
      },
    ];
    return answerInlineQuery(result);
  }
});

function fixPaths() {
  for (let style of Object.keys(STYLES)) {
    try {
      let path = require('path').join('/tmp', style, 'video');
      fs.mkdirSync(path, {recursive: true});
    } catch (e) {
      console.log(e);
    }
  }
}

module.exports = {
  bot,
  server(req, res) {
    if (req.url === '/') {
      res.end(`
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Crab Rave Bot</title>
        </head>
        <body>
        <main>
        <h1>it's a tool for adding things to crab rave</h1>
        <form action="/add-text" method="GET">
        <textarea id="text" name="text" rows="6" cols="25"></textarea>
        <p>
          Style:
          <input type="radio" id="classic" name="style" value="classic" checked><label for="classic">Classic</label>
          <input type="radio" id="otamatone" name="style" value="otamatone"><label for="otamatone">Otamatone</label> (<a href="https://youtu.be/VI5I3MuKJlo">original</a> by TheRealSullyG)
        </p>
        <input type="submit" value="Overlay!">
        </form>
        <a href="https://t.me/crabravebot">also available as a Telegram bot</a>
        </main>
        <img id="preview" style="max-width: 100%;" src="https://${process.env.PROJECT_DOMAIN}.glitch.me/video/.png">
        <script type="text/javascript">
        const img = document.getElementById('preview'),
          text = document.getElementById('text'),
          classic = document.getElementById('classic');
        setInterval(() => {
          let style = classic.checked ? 'classic' : 'otamatone';
          img.src = "https://${process.env.PROJECT_DOMAIN}.glitch.me/video/" + encodeURIComponent(text.value) + '.png?style=' + style;
        }, 1000);
        </script>
        </body>
        </html>
      `);
    } else if (req.url.startsWith('/add-text')) {
      const parsed = url.parse(req.url, true);
      const data = parsed.query.text;
      const style = parsed.query.style;
      res.writeHead(303, {
        'Location': "https://" + process.env.PROJECT_DOMAIN + ".glitch.me/video/" + encodeURIComponent(data) + ".mp4?style=" + style
      });
      res.end();
    } else if (req.url.startsWith('/video/')) {
      fixPaths();
      if (!fs.existsSync('/tmp/classic/video')) {
        console.log('what???');
        child_process.spawnSync('ls', ['/tmp', '/tmp/classic', '/tmp/classic/video']);
      }
      const parsed = url.parse(req.url, true);
      const match = /^\/video\/(.*)\.(mp4|png)/.exec(parsed.pathname);
      if (match === null) {
        console.error('Bad URL: ' + match);
        res.writeHead(400);
        res.end();
        return;
      }
      const text = decodeURIComponent(match[1]);
      console.log('Match:', text);
      const type = match[2];
      if (type === 'mp4') {
        const ev = hny.newEvent();
        ev.addField('type', 'bake');
        ev.addField('text', text);
        ev.send();
      }
      const style = parsed.query.style || 'classic';
      if (!Object.keys(STYLES).includes(style)) {
        console.error("Bad style");
        res.writeHead(400);
        res.end();
        return;
      }
      const path = require('path').join('/tmp', style, encodeURIComponent(match[0]));
      if (type === 'mp4') {
        res.setHeader('Content-Type', 'video/mp4');
      } else {
        res.setHeader('Content-Type', 'image/png');
      }
      console.log('Name:', path);
      // TODO don't do this dumb thing
      if (!fs.existsSync(path)) {
        if (!fs.existsSync(path + '.png')) {
          const dom = new JSDOM(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg version="1.1" viewBox="0 0 848 480">
</svg>`, {contentType: 'image/svg+xml'});
          const document = dom.window.document;
          const lines = text.split('\n');
          let y = 300 - (75 * lines.length) / 2;
          for (let line of lines) {
            const lineNode = document.createElement('text');
            lineNode.setAttribute('x', 424);
            lineNode.setAttribute('y', y);
            y += 75;
            lineNode.setAttribute('style', "text-anchor:middle;alignment-baseline:middle;font-family:'DejaVu Sans',sans-serif;font-weight:bold;font-size:48pt;fill:white;stroke:black;stroke-width:1px;");
            lineNode.textContent = line;
            document.querySelector('svg').append(lineNode);
          }
          const svg = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + dom.serialize();
          fs.writeFileSync(path + '.svg', svg);
          child_process.spawnSync('convert', ['-background', 'none', path + '.svg', path + '.png'], {stdio: ['inherit', 'inherit', 'inherit']});
        }
        if (type === 'mp4') {
          let background = STYLES[style].video;
          let args = [
            '-hide_banner',
            '-i', background,
            '-i', path + '.png',
            '-filter_complex', 'overlay=x=0:y=0',
            '-c:v', 'libx264', '-preset', 'superfast', '-crf', '27', '-f', 'mp4', '-c:a', 'copy',
            '-y', path
          ];
          console.log('ffmpeg', ...args);
          let child = child_process.spawnSync(
            'ffmpeg',
            args,
            {
              stdio: ['inherit', 'inherit', 'inherit']
            }
          );
        } else {
          let background_url = STYLES[style].thumb;
          let background = '/tmp/' + style + '.png';
          if (!fs.existsSync(background)) {
            child_process.spawnSync('curl', ['-o', background, background_url]);
          }
          child_process.spawnSync('composite', [path + '.png', background, path]);
        }
      }
      if (fs.existsSync(path)) {
        fs.createReadStream(path).pipe(res);
      } else {
        console.log('what the fuck', path);
      }
    }
  },
};
