const { jsPDF } = window.jspdf;

// ==========================================
// ★ イベントリスナー定義 (DOM操作)
// ==========================================

// ファイル選択時 -> プレビュー更新
document.getElementById('imageInput').addEventListener('change', async function(e) {
    const count = e.target.files.length;
    document.getElementById('fileCount').innerText = count > 0 ? `${count}枚 選択中` : "未選択";
    await updatePreview();
});

// 設定値が変わった時 -> プレビュー更新 (一括設定)
const settings = ['imgWidth', 'gap', 'pageSize', 'drawBorder', 'borderColor'];
settings.forEach(id => {
    document.getElementById(id).addEventListener('change', updatePreview);
});

// PDF作成ボタン
document.getElementById('generateBtn').addEventListener('click', generatePDF);

// フィードバックボタン
document.getElementById('feedbackLink').addEventListener('click', openFeedbackForm);

// 初期ロード時
window.addEventListener('DOMContentLoaded', updatePreview);


// ==========================================
// ★ メインロジック
// ==========================================

/**
 * @description フォームの設定値に基づいてCanvasにプレビューをリアルタイム描画し、総ページ数を計算して表示します。
 * - 1ページ目のみCanvasに描画します。
 * - 2ページ目以降は計算のみ行い、総ページ数を算出します。
 * @returns {Promise<void>} 描画処理が完了した後に解決されるPromise
 */
async function updatePreview() {
    const files = document.getElementById('imageInput').files;
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');

    // --- 設定値の取得 ---
    const selectedSize = document.getElementById('pageSize').value;
    const targetW_mm = parseFloat(document.getElementById('imgWidth').value);
    const gap_mm = parseFloat(document.getElementById('gap').value) || 0;
    const needBorder = document.getElementById('drawBorder').checked;
    const colorKey = document.getElementById('borderColor').value;

    // --- 用紙サイズ定義 (mm) ---
    const sizeMap = {
        'a4': { w: 210, h: 297, margin: 10 },
        'l': { w: 89, h: 127, margin: 5 }
    };
    const pageConfig = sizeMap[selectedSize];

    // --- 画質設定 ---
    // Canvasの解像度を上げるためのスケール係数 (1mm = 4px)
    const SCALE = 4;
    canvas.width = pageConfig.w * SCALE;
    canvas.height = pageConfig.h * SCALE;

    // --- 背景クリア ---
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ファイル未選択時の表示処理
    if (files.length === 0) {
        ctx.fillStyle = '#ccc';
        ctx.font = `bold ${10 * SCALE}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ここにプレビューが表示されます', canvas.width / 2, canvas.height / 2);

        document.getElementById('fileCount').innerText = "未選択";
        document.getElementById('pageTotal').innerText = "";
        return;
    }

    // --- 描画ループ準備 ---
    let x_mm = pageConfig.margin;
    let y_mm = pageConfig.margin;
    let maxLineHeight_mm = 0;
    let currentPage = 1;

    const colorMap = {
        'gray': '#c8c8c8',
        'black': '#000000',
        'pink': '#ff69b4',
        'blue': '#6495ED'
    };
    const strokeColor = colorMap[colorKey];

    // ファイル数表示更新
    document.getElementById('fileCount').innerText = `${files.length}枚 選択中`;

    for (const file of files) {
        try {
            const imgData = await readFileAsDataURL(file);
            const imgElement = await loadImageElement(imgData);

            const imgW = imgElement.width;
            const imgH = imgElement.height;
            // アスペクト比を維持して高さを計算
            const targetH_mm = (targetW_mm / imgW) * imgH;

            // 改行判定
            if (x_mm + targetW_mm > pageConfig.w - pageConfig.margin) {
                x_mm = pageConfig.margin;
                y_mm += maxLineHeight_mm + gap_mm;
                maxLineHeight_mm = 0;
            }

            // 改ページ判定
            if (y_mm + targetH_mm > pageConfig.h - pageConfig.margin) {
                currentPage++;
                // 座標リセット
                x_mm = pageConfig.margin;
                y_mm = pageConfig.margin;
                maxLineHeight_mm = 0;
            }

            // 1ページ目の場合のみ描画を実行
            if (currentPage === 1) {
                ctx.drawImage(imgElement, x_mm * SCALE, y_mm * SCALE, targetW_mm * SCALE, targetH_mm * SCALE);

                if (needBorder) {
                    ctx.lineWidth = 0.2 * SCALE;
                    ctx.strokeStyle = strokeColor;
                    ctx.strokeRect(x_mm * SCALE, y_mm * SCALE, targetW_mm * SCALE, targetH_mm * SCALE);
                }
            }

            // 次の座標へ移動
            x_mm += targetW_mm + gap_mm;

            if (targetH_mm > maxLineHeight_mm) {
                maxLineHeight_mm = targetH_mm;
            }

        } catch (err) {
            console.error("プレビュー描画エラー:", err);
        }
    }

    // 合計ページ数を表示
    const pageTotalElem = document.getElementById('pageTotal');
    pageTotalElem.innerText = `(全${currentPage}ページ予定)`;

    // 2ページ以上になる場合赤字で注意喚起
    if (currentPage > 1) {
        pageTotalElem.style.color = "#ff4757";
    } else {
        pageTotalElem.style.color = "#4CAF50";
    }
}

/**
 * @description フォームの入力値と選択された画像を使用してPDFを生成し、ダウンロードを開始します。
 * @returns {Promise<void>} PDF生成と保存の非同期処理
 */
async function generatePDF() {
    const files = document.getElementById('imageInput').files;
    if (files.length === 0) {
        alert("画像が選択されていません。");
        return;
    }

    const btn = document.getElementById('generateBtn');
    const status = document.getElementById('status');

    // ボタンを無効化して連打防止
    btn.disabled = true;
    status.innerText = "処理中...";

    try {
        const selectedSize = document.getElementById('pageSize').value;
        const targetW = parseFloat(document.getElementById('imgWidth').value);
        const gap = parseFloat(document.getElementById('gap').value);

        // バリデーションチェック
        if (targetW <= 0 || isNaN(targetW)) {
            throw new Error("画像の横幅は正の数で入力してください。");
        }
        if (gap < 0 || isNaN(gap)) {
            throw new Error("余白は0以上の数で入力してください。");
        }

        const needBorder = document.getElementById('drawBorder').checked;
        const colorKey = document.getElementById('borderColor').value;

        const colorMap = { 'gray': [200, 200, 200], 'black': [0, 0, 0], 'pink': [255, 105, 180], 'blue': [100, 149, 237] };
        const sizeMap = { 'a4': { w: 210, h: 297, margin: 10 }, 'l': { w: 89, h: 127, margin: 5 } };
        const pageConfig = sizeMap[selectedSize];

        // jsPDFインスタンス作成
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: [pageConfig.w, pageConfig.h] });

        let x = pageConfig.margin;
        let y = pageConfig.margin;
        let maxLineHeight = 0;

        for (const file of files) {
            const imgData = await readFileAsDataURL(file);
            const dims = await getImageDimensions(imgData);
            const targetH = (targetW / dims.w) * dims.h;

            // 改行
            if (x + targetW > pageConfig.w - pageConfig.margin) {
                x = pageConfig.margin;
                y += maxLineHeight + gap;
                maxLineHeight = 0;
            }
            // 改ページ
            if (y + targetH > pageConfig.h - pageConfig.margin) {
                doc.addPage();
                x = pageConfig.margin;
                y = pageConfig.margin;
                maxLineHeight = 0;
            }

            const imgType = file.type === 'image/png' ? 'PNG' : 'JPEG';
            doc.addImage(imgData, imgType, x, y, targetW, targetH);

            if (needBorder) {
                doc.setLineWidth(0.1);
                const rgb = colorMap[colorKey];
                doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
                doc.rect(x, y, targetW, targetH);
            }

            x += targetW + gap;
            if (targetH > maxLineHeight) maxLineHeight = targetH;
        }

        // タイムスタンプ付きで保存
        const now = new Date();
        const ts = now.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        doc.save(`images_${ts}.pdf`);
        status.innerText = "完了しました";

    } catch (error) {
        alert(error.message);
        status.innerText = "エラーが発生しました";
    } finally {
        btn.disabled = false;
    }
}


// ==========================================
// ★ ヘルパー関数
// ==========================================

/**
 * @description FileオブジェクトをBase64のData URLとして読み込む非同期処理。
 * @param {File} file - 読み込むファイルオブジェクト
 * @returns {Promise<string>} Base64形式のData URL文字列
 */
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * @description 画像のURLから幅と高さを非同期で取得します（PDF生成用）。
 * @param {string} url - Base64形式の画像URL
 * @returns {Promise<{w: number, h: number}>} 画像の幅(w)と高さ(h)を含むオブジェクト
 */
function getImageDimensions(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * @description 画像URLからHTMLImageElementを生成して読み込みます（Canvas描画用）。
 * @param {string} url - 画像のソースURL（DataURLなど）
 * @returns {Promise<HTMLImageElement>} 読み込み完了した画像要素
 */
function loadImageElement(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * @description フィードバック用のGoogleフォームを新しいウィンドウで開きます。
 */
function openFeedbackForm() {
    window.open("https://forms.gle/tcwM6t2qGXyEZpFcA", '_blank');
}
