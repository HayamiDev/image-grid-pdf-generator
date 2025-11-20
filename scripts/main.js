const { jsPDF } = window.jspdf;

document.getElementById('imageInput').addEventListener('change', function (e) {
    const count = e.target.files.length;
    document.getElementById('fileCount').innerText = count > 0 ? `${count}枚 選択中` : "未選択";
});

async function generatePDF() {
    const files = document.getElementById('imageInput').files;

    if (files.length === 0) {
        alert("画像が選択されていません。");
        return;
    }

    const btn = document.getElementById('generateBtn');
    const status = document.getElementById('status');

    btn.disabled = true;
    status.innerText = "処理中...";

    try {
        const selectedSize = document.getElementById('pageSize').value;
        const targetW = parseFloat(document.getElementById('imgWidth').value);
        const gap = parseFloat(document.getElementById('gap').value);

        const needBorder = document.getElementById('drawBorder').checked;
        const colorKey = document.getElementById('borderColor').value;

        const colorMap = {
            'gray': [200, 200, 200],
            'black': [0, 0, 0],
            'pink': [255, 105, 180],
            'blue': [100, 149, 237]
        };

        const sizeMap = {
            'a4': { w: 210, h: 297, margin: 10 },
            'l': { w: 89, h: 127, margin: 5 }
        };
        const pageConfig = sizeMap[selectedSize];

        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: [pageConfig.w, pageConfig.h]
        });

        let x = pageConfig.margin;
        let y = pageConfig.margin;
        let maxLineHeight = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const imgData = await readFileAsDataURL(file);
            const dims = await getImageDimensions(imgData);

            const targetH = (targetW / dims.w) * dims.h;

            if (x + targetW > pageConfig.w - pageConfig.margin) {
                x = pageConfig.margin;
                y += maxLineHeight + gap;
                maxLineHeight = 0;
            }

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

            if (targetH > maxLineHeight) {
                maxLineHeight = targetH;
            }
        }

        const now = new Date();
        const pad = (n, d) => String(n).padStart(d, '0');
        const timestamp =
            now.getFullYear() +
            pad(now.getMonth() + 1, 2) +
            pad(now.getDate(), 2) +
            pad(now.getHours(), 2) +
            pad(now.getMinutes(), 2) +
            pad(now.getSeconds(), 2) +
            pad(now.getMilliseconds(), 3);

        doc.save(`images_${timestamp}.pdf`);
        status.innerText = "完了しました";

    } catch (error) {
        console.error(error);
        status.innerText = "エラーが発生しました";
        alert("処理中にエラーが発生しました。別の画像でお試しください。");
    } finally {
        btn.disabled = false;
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getImageDimensions(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = reject;
        img.src = url;
    });
}

function openFeedbackForm() {
    const feedbackUrl = "https://forms.gle/tcwM6t2qGXyEZpFcA";
    window.open(feedbackUrl, '_blank');
}
