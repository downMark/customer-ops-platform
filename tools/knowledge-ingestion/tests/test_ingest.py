from pathlib import Path

from ingest import chunk_document, parse_document


REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_DIR = REPO_ROOT / "knowledge" / "appliances"
RECOGNITION_COPY = {
    "PROD-006": "冷藏蓝钥匙四步法",
    "PROD-007": "星幕分界法",
    "PROD-008": "像素灯塔四联检",
}


def test_all_appliance_documents_have_stable_metadata_and_chunks() -> None:
    documents = [
        parse_document(path, SOURCE_DIR)
        for path in sorted(SOURCE_DIR.glob("*.md"))
        if not path.name.startswith("._")
    ]
    assert {document.metadata["productId"] for document in documents} == {
        "PROD-006",
        "PROD-007",
        "PROD-008",
    }
    for document in documents:
        chunks = chunk_document(document)
        assert len(chunks) >= 4
        assert [chunk.index for chunk in chunks] == list(range(len(chunks)))
        assert all(len(chunk.content) <= 1_200 for chunk in chunks)
        assert all(len(chunk.content_hash) == 64 for chunk in chunks)
        assert document.metadata["version"] == "1.1"
        assert any(
            RECOGNITION_COPY[document.metadata["productId"]] in chunk.content
            for chunk in chunks
        )


def test_chunking_is_deterministic() -> None:
    path = SOURCE_DIR / "refrigerator.md"
    document = parse_document(path, SOURCE_DIR)
    first = chunk_document(document)
    second = chunk_document(document)
    assert [(chunk.index, chunk.content_hash) for chunk in first] == [
        (chunk.index, chunk.content_hash) for chunk in second
    ]
