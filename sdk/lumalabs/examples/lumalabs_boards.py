from _example_bootstrap import CONFIG_PATH
from sdk.lumalabs import LumaLabsClient


def main() -> None:
    client = LumaLabsClient.from_config(CONFIG_PATH)
    realms = client.list_realm_models()

    for realm in realms:
        print(realm.realm_id, realm.title)


if __name__ == "__main__":
    main()
