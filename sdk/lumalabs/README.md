# LumaLabs SDK

Minimal Python SDK for the private Luma web API captured from `https://app.lumalabs.ai/`.

Luma currently uses a web session cookie instead of a Bearer token. The important cookie is:

```text
wos-session=Fe26...
```

Do not commit a real `wos-session`. It is a login credential.

## Config

Create `config/lumalabs_config.json`:

```json
{
  "accounts": [
    {
      "label": "luma-main",
      "wos_session": "Fe26.2*1*...",
      "team_id": "17f1d168-b5d5-48db-b143-b512d213ce29",
      "default_realm_id": "9f950114-dc53-4c2a-b122-62d3a172ed58",
      "enabled": true
    }
  ],
  "timeout": 60,
  "proxy": ""
}
```

Or use environment variables:

```powershell
$env:LUMALABS_WOS_SESSION="Fe26.2*1*..."
$env:LUMALABS_TEAM_ID="17f1d168-b5d5-48db-b143-b512d213ce29"
$env:LUMALABS_REALM_ID="9f950114-dc53-4c2a-b122-62d3a172ed58"
```

## Usage

```python
from sdk.lumalabs import LumaLabsClient

client = LumaLabsClient.from_config()
client.check_login()

boards = client.list_boards()
usage = client.get_usage()

board = client.create_board("Untitled")
print(board.realm_id, board.title)

action = client.create_image(
    "A quiet cinematic interior, warm lamp light, realistic photography",
    aspect_ratio="16:9",
    resolution="4K",
    quality="high",
    output_format="png",
)

print(action.action_id, action.output_ids)
```

## Download Result

```python
artifact = client.get_artifact("hv1WyOMl", realm_id="817c8255-2b92-4bd3-acb7-a36ad65eaf76")
url = client.build_artifact_url(artifact, realm_id="817c8255-2b92-4bd3-acb7-a36ad65eaf76")
path = client.download_artifact(
    artifact,
    realm_id="817c8255-2b92-4bd3-acb7-a36ad65eaf76",
    save_dir="data/lumalabs_downloads",
)

print(client.get_board_url("817c8255-2b92-4bd3-acb7-a36ad65eaf76", artifact_id=artifact.artifact_id))
print(path)
```

## Captured Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/vespa/users/notifications` | session/login probe |
| GET | `/api/vespa/teams/{team_id}/realms?skip=0&limit=50&ownership=all` | list boards/realms |
| POST | `/api/vespa/teams/{team_id}/realms` | create board/realm |
| GET | `/api/vespa/teams/{team_id}/usage` | usage/credits |
| GET | `/api/vespa/teams/{team_id}/members` | team members |
| GET | `/api/vespa/teams/{team_id}/directives` | UI directives and team flags |
| GET | `/api/vespa/realms/{realm_id}/signature` | board signature |
| POST | `/api/vespa/realms/{realm_id}/artifacts` | register uploaded artifact metadata |
| POST | `/api/vespa/realms/{realm_id}/actions` | create generation action |

The Next.js `/_rsc`, `next-action`, and `text/x-component` requests are intentionally not wrapped here because they are frontend internals and may change after every deployment.
