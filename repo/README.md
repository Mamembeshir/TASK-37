# Retail Operations & Customer Care Hub

## Start

```bash
docker-compose up --build
```

## Services

| Service  | Container Port | Host Port |
|----------|----------------|-----------|
| frontend | `80`           | `4200`    |
| backend  | `3000`         | `3000`    |
| postgres | `5432`         | `5432`    |

## Verification

1. Check all containers are running:

```bash
docker-compose ps
```

2. Verify backend health endpoint:

```bash
curl -s http://localhost:3000/health
```

Expected: JSON response with `"status":"ok"`.

3. Verify frontend is reachable in a browser:

`http://localhost:4200`

4. Verify PostgreSQL port is open:

```bash
docker-compose exec postgres pg_isready -U postgres -d retail_hub
```

Expected: `accepting connections`.
