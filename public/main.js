// Main page JavaScript for creating new meetings

document.addEventListener('DOMContentLoaded', function() {
    const createMeetingBtn = document.getElementById('createMeetingBtn');
    
    if (createMeetingBtn) {
        createMeetingBtn.addEventListener('click', createNewMeeting);
    }
});

async function createNewMeeting() {
    const button = document.getElementById('createMeetingBtn');
    
    // Disable button and show loading state
    button.disabled = true;
    button.textContent = 'Создание встречи...';
    
    try {
        const response = await fetch('/api/meet/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            // Redirect to the meeting page
            window.location.href = `/${data.meetId}`;
        } else {
            throw new Error('Failed to create meeting');
        }
    } catch (error) {
        console.error('Error creating meeting:', error);
        alert('Ошибка при создании встречи. Попробуйте еще раз.');
        
        // Reset button state
        button.disabled = false;
        button.textContent = 'Создать встречу';
    }
}