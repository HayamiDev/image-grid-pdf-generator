import os
import asyncio
from github import Github
import google.generativeai as genai
from openai import OpenAI
from anthropic import Anthropic
from dataclasses import dataclass

# --- CONFIG設定クラスの定義 ---
@dataclass(frozen=True)
class ReviewConfig:
    gemini_model: str
    gpt_model: str
    claude_model: str
    summarizer_model: str
    small_diff_threshold: int
    flash_only_max_tokens: int

# --- CONFIGインスタンスの作成（読み込み） ---
CONFIG = ReviewConfig(
    gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    gpt_model=os.getenv("GPT_MODEL", "gpt-4o"),
    claude_model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5"),
    summarizer_model=os.getenv("SUMMARIZER_MODEL", "gemini-2.5-pro"),

    small_diff_threshold=int(os.getenv("SMALL_DIFF_THRESHOLD", 30000)),
    flash_only_max_tokens=int(os.getenv("FLASH_ONLY_MAX_TOKENS", 300000))
)

# AIの役割と指示を定義するシステムプロンプト
SYSTEM_PROMPT = """
あなたは経験10年以上の厳格なシニアソフトウェアエンジニアです。
あなたの仕事は、以下のコード差分（Diff）を徹底的にレビューし、プロダクトの品質を最高レベルに保つことです。

【重要指示】
1.  指摘事項は、**ファイル名**と**セクション**を明確にした上で、Markdownの箇条書きで必ず出力してください。
2.  具体的な改善案は、簡潔なコード例を添えてください。
3.  指摘がない場合は、「指摘事項なし、このPRは即マージOKです」とだけ回答してください。

【レビュー重点項目】
* **バグ**：論理的な誤り、予期せぬクラッシュ、エッジケース処理の漏れ。
* **セキュリティ**：潜在的な脆弱性（インジェクション、情報漏洩、認可の欠如など）。
* **保守性**：コードの複雑性（循環的複雑度が高い部分）、将来のリファクタリングが必要な設計上の問題。
* **可読性**：命名規則の違反、マジックナンバーの使用、コメント不足。
"""

# GitHubの設定
g = Github(os.getenv("GITHUB_TOKEN"))
repo = g.get_repo(os.getenv("GITHUB_REPOSITORY"))
pr_number = int(os.getenv("GITHUB_REF").split("/")[-2])
pr = repo.get_pull(pr_number)

# 変更差分(Diff)の取得
def get_diff():
    return pr.get_files()

def check_diff_size(diff_text):
    # 簡単なトークン数の概算 (文字数/3で近似)
    token_count = len(diff_text) // 3

    if token_count > CONFIG.flash_only_max_tokens:
        pr.create_issue_comment(
            f"🚨 **警告: DIFFサイズが大きすぎます (約 {token_count} トークン)**\n"
            "AIレビューをスキップしました。レビュー精度とコスト抑制のため、手動でのレビューをお願いします。"
        )
        return False, token_count
    return True, token_count

# 各AIへのリクエスト関数
async def ask_gemini(diff_text):
    try:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model = genai.GenerativeModel(
                CONFIG.gemini_model,
                system_instruction=SYSTEM_PROMPT
            )
        response = model.generate_content(f"以下のコード差分をレビューしてください:\n---\n{diff_text}\n---")
        return f"## ♊ Gemini\n{response.text}"
    except Exception as e:
        return f"## ♊ Gemini (Error)\nエラーが発生しました: {e}"

async def ask_gpt4o(diff_text):
    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=CONFIG.gpt_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"以下のコード差分をレビューしてください:\n---\n{diff_text}\n---"}
            ]
        )
        return f"## 🤖 ChatGPT\n{response.choices[0].message.content}"
    except Exception as e:
        return f"## 🤖 ChatGPT (Error)\nエラーが発生しました: {e}"

async def ask_claude(diff_text):
    try:
        client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        message = client.messages.create(
            model=CONFIG.claude_model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": f"以下のコード差分をレビューしてください:\n---\n{diff_text}\n---"}
            ]
        )
        return f"## 🧠 Claude\n{message.content[0].text}"
    except Exception as e:
        return f"## 🧠 Claude (Error)\nエラーが発生しました: {e}"

async def summarize_reviews(all_results):
    try:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model_name = CONFIG.summarizer_model

        summarizer_model = genai.GenerativeModel(
            model_name,
            system_instruction="あなたは、複数のAIレビュアーの意見を統合し、最も重要で優先度の高い指摘事項だけを、重複なく一つのMarkdownリストにまとめる編集長です。トーンは厳しく、冗長な表現は全て削除してください。"
        )

        # 3つのレビュー結果を結合
        combined_text = "\n\n---\n\n".join(all_results)

        user_prompt = f"""以下の3つのAIレビュー結果を統合し、重複を排除し、具体的な指摘を優先度順に再構成して出力してください。

【3つのAIレビュー結果】
---
{combined_text}
---
"""
        response = summarizer_model.generate_content(user_prompt)

        return f"# 👑 統合AIレビュー (by {model_name})\n\n{response.text}"

    except Exception as e:
        return f"# 👑 統合AIレビュー (Error)\n統合処理中にエラーが発生しました: {e}\n\n" + "\n\n---\n\n".join(all_results)

def create_final_comment(summary_report: str, individual_results: list[str]) -> str:
    final_comment = summary_report
    individual_section_content = "## 📄 個別AIレビュー結果 (生の出力)\n"
    individual_section_content += "これらの結果を統合AIがまとめています。統合結果に不備がある場合にご参照ください。\n\n"
    individual_section_content += "\n\n---\n\n".join(individual_results)
    collapsible_section = f"""
<details>
<summary>個別AIの生レビュー結果を見る (クリックで展開)</summary>

{individual_section_content}

</details>
"""
    final_comment += "\n\n" + collapsible_section
    return final_comment

async def select_and_run_models(diff_text: str, token_count: int) -> list[str]:
    """
    DIFFサイズに基づき、最適なAIモデルを選択し、非同期でレビューを実行する。
    """
    if token_count <= CONFIG.small_diff_threshold:
        # 高性能レビュー（3モデル使用）
        print("INFO: 3つのAIモデルによる並列レビューを実行中...")
        return await asyncio.gather(
            ask_gemini(diff_text),
            ask_gpt4o(diff_text),
            ask_claude(diff_text),
            return_exceptions=True
        )

    elif token_count <= CONFIG.flash_only_max_tokens:
        # コスト優先レビュー（Gemini Flashのみ使用）
        print(f"INFO: DIFFサイズが大きいため ({token_count} tokens)、Gemini Flashのみでレビューを実行します。")
        pr.create_issue_comment(
            f"⚠️ **DIFFサイズ ({token_count} トークン) のため、Geminiのみでコスト優先レビューを実施します。**"
        )
        results_raw = [await ask_gemini(diff_text)]

    else:
        return []

    results = [r for r in results_raw if not isinstance(r, Exception)]

    # 全てのAIが失敗した場合の処理
    if not results:
        pr.create_issue_comment("🚨 致命的なエラー: 全てのAIサービスへの接続が失敗しました。APIキーまたはサービス状態を確認してください。")
        return []

    return results


# メイン処理
async def main():
    files = get_diff()
    diff_text = ""
    for file in files:
        if file.filename.endswith(('.lock', '.png', '.jpg', '.svg')): continue
        if not file.patch:
             continue
        diff_text += f"File: {file.filename}\nDiff:\n{file.patch}\n\n"

    if not diff_text:
        print("変更差分が検出されないため、処理を終了します。")
        return

    is_ok, token_count = check_diff_size(diff_text)
    if not is_ok: return

    results = await select_and_run_models(diff_text, token_count)

    # レビューが実行できなかった場合終了
    if not results:
        return

    print("INFO: レビュー結果の統合処理を実行中...")
    summary_report = await summarize_reviews(results)

    final_comment = create_final_comment(summary_report, results)

    # 過去のボットのコメントを削除するロジック
    print("INFO: 既存のレビューコメントを削除中...")
    comments = pr.get_issue_comments()
    HEADER_IDENTIFIER = "# 👑 統合AIレビュー"

    for comment in comments:
        if comment.body and HEADER_IDENTIFIER in comment.body:
            try:
                comment.delete()
            except Exception as e:
                print(f"WARN: コメント削除に失敗しました (無視): {e}")

    # コメント投稿
    pr.create_issue_comment(final_comment)
    print("SUCCESS: レビュー処理が完了しました。")

if __name__ == "__main__":
    asyncio.run(main())
