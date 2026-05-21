from _example_bootstrap import CONFIG_PATH
from sdk.lumalabs import LumaLabsClient


def main() -> None:
    client = LumaLabsClient.from_config(CONFIG_PATH)
    realm_id = "817c8255-2b92-4bd3-acb7-a36ad65eaf76"
    artifact_id = "hv1WyOMl"

    artifact = client.get_artifact(artifact_id, realm_id=realm_id)
    print("state:", artifact.state)
    print("board_url:", client.get_board_url(realm_id, artifact_id=artifact.artifact_id))

    path = client.download_artifact(
        artifact,
        realm_id=realm_id,
        save_dir="data/lumalabs_downloads",
    )
    print("saved:", path)


if __name__ == "__main__":
    main()
