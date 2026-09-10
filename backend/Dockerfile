FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

# Same command as the Procfile, just with a fixed port instead of Render's $PORT
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
