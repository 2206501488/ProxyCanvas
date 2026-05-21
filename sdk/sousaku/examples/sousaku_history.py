from _example_bootstrap import CONFIG_PATH
from sdk.sousaku import SousakuClient


def main() -> None:
    client = SousakuClient.from_config(CONFIG_PATH)
    profile = client.get_user_profile()
    print(f"user: {profile.nick_name}")
    print(f"credits: {profile.total_credit}")
    print(f"share_code: {profile.share_code}")
    print(f"inviter_share_code: {profile.inviter_share_code}")
    print(f"pending_claims: {profile.complete_pending_claim_num}")
    client.save_user_profile(str(CONFIG_PATH.parent / "sousaku_account_snapshot.json"))

    for task in client.list_history_tasks(page=1, page_size=15):
        print(f"{task.task_id} {task.status} progress={task.progress} images={len(task.images)}")
        for image in task.images:
            print(f"  {image.url} {image.width}x{image.height}")


if __name__ == "__main__":
    main()
