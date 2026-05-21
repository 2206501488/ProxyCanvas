import sys

from _example_bootstrap import CONFIG_PATH
from sdk.sousaku import SousakuClient


def main() -> None:
    if len(sys.argv) < 2:
        raise RuntimeError("Usage: python sdk/sousaku/examples/sousaku_task_status.py task_id [task_id ...]")

    client = SousakuClient.from_config(CONFIG_PATH)
    for task in client.get_task_statuses(sys.argv[1:]):
        print(f"{task.task_id} {task.status} progress={task.progress} images={len(task.images)}")
        for image in task.images:
            print(f"  {image.url} {image.width}x{image.height}")


if __name__ == "__main__":
    main()
