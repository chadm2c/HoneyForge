FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

COPY . .

ENV HF_SPOOL_PATH=/data/agent-spool.jsonl
VOLUME /data
EXPOSE 8000

CMD ["python", "-m", "agent"]