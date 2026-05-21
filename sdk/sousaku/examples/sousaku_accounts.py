from _example_bootstrap import CONFIG_PATH
from sdk.sousaku import SousakuClient


def main() -> None:
    client = SousakuClient.from_config(CONFIG_PATH)
    records = client.save_account_records()

    print(f"saved {len(records)} account records")
    for record in records:
        duplicate = " duplicate" if record.get("duplicate") else ""
        print(
            f"{record.get('token_index')}: "
            f"{record.get('user_email') or record.get('user_id')} "
            f"credits={record.get('total_credit')} "
            f"share={record.get('share_code')} "
            f"inviter={record.get('inviter_share_code')}"
            f"{duplicate}"
        )


if __name__ == "__main__":
    main()
