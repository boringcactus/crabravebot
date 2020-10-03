FROM python:3.7-alpine

RUN apk add --no-cache gcc libc-dev libffi-dev zlib-dev openssl-dev jpeg-dev ffmpeg freetype-dev

WORKDIR /usr/src/app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD [ "gunicorn", "-w", "1", "bot:app", "--log-file", "-" ]
