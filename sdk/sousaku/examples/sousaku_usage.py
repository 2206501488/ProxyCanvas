from _example_bootstrap import CONFIG_PATH
from sdk.sousaku import SousakuClient


def main() -> None:
    client = SousakuClient.from_config(CONFIG_PATH)
    reference_paths = [
        # r"C:\path\to\reference_1.jpg",
        # r"C:\path\to\reference_2.jpg",
    ]
    refs = client.upload_reference_images(reference_paths) if reference_paths else []
    images = client.generate_sync(
        "1girl, solo, masterpiece, best quality, ultra-detailed, cinematic lighting",
        model="gpt-image-2",
        resolution="4k",
        ratio="1:1",
        number=1,
        reference_images=refs,
    )

    for image in images:
        print(image.url)
        print(image.saved_path)


if __name__ == "__main__":
    main()
