export default function FilePicker(callback: (url: string) => void, accept: string = ''): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const url = URL.createObjectURL(file);
        console.log('Loading file:', file.name, 'from URL:', url);

        callback(url);
    };

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
}