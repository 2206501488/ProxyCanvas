from _example_bootstrap import CONFIG_PATH
from sdk.lumalabs import LumaLabsClient


def main() -> None:
    client = LumaLabsClient.from_config(CONFIG_PATH)
    board = client.create_board("Untitled")

    print("board_id:", board.realm_id)
    print("title:", board.title)
    print("raw:", board.raw)

    if board.realm_id:
        signature = client.get_realm_signature(realm_id=board.realm_id)
        print("signature:", signature)


if __name__ == "__main__":
    main()
