from _example_bootstrap import CONFIG_PATH
from sdk.lumalabs import LumaLabsClient


def main() -> None:
    client = LumaLabsClient.from_config(CONFIG_PATH)
    client.check_login()

    action = client.create_image(
        "A quiet cinematic study room, warm lamp light, realistic photography, 35mm lens",
        aspect_ratio="16:9",
        resolution="4K",
        quality="high",
        output_format="png",
        references=[],
    )

    print("action_id:", action.action_id)
    print("type:", action.type)
    print("status:", action.status)
    print("output_ids:", action.output_ids)
    print("raw:", action.raw)


if __name__ == "__main__":
    main()
